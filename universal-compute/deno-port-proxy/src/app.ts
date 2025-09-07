import { Hono } from 'jsr:@hono/hono'

export type LocalResolver = (
  port: number,
) => ((req: Request) => Promise<Response>) | undefined

export interface ProxyOptions {
  resolveLocal?: LocalResolver
}

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

function stripHopByHop(h: Headers) {
  for (const k of HOP_BY_HOP) h.delete(k)
}

function parsePort(v: string | null): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

async function proxyHTTP(req: Request, opts: ProxyOptions): Promise<Response> {
  const inUrl = new URL(req.url)
  const port = parsePort(inUrl.searchParams.get('port'))
  if (!port) return new Response('invalid or missing port', { status: 400 })

  // Build the target URL with port param removed
  inUrl.searchParams.delete('port')
  const qs = inUrl.searchParams.toString()
  const target = new URL(
    `${inUrl.pathname}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:${port}`,
  )

  // Prepare headers: copy, strip hop-by-hop, set Host and proxy headers
  const fwdHeaders = new Headers(req.headers)
  stripHopByHop(fwdHeaders)
  fwdHeaders.set('host', `127.0.0.1:${port}`)

  const xf = req.headers.get('x-forwarded-for')
  const clientIP = req.headers.get('x-real-ip') ?? ''
  fwdHeaders.set('x-forwarded-for', xf ? `${xf}, ${clientIP}` : clientIP)
  fwdHeaders.set('x-forwarded-proto', inUrl.protocol.replace(':', ''))
  fwdHeaders.set('x-forwarded-host', inUrl.host)
  fwdHeaders.set('via', '1.1 hono-deno')

  const forwardInit: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    body: req.body,
    redirect: 'manual',
  }

  const dispatch = opts.resolveLocal?.(port)
  const upstreamRes = dispatch
    ? await dispatch(new Request(target, forwardInit))
    : await fetch(target, forwardInit)

  const outHeaders = new Headers(upstreamRes.headers)
  stripHopByHop(outHeaders)
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  })
}

function proxyWS(req: Request): Response {
  const inUrl = new URL(req.url)
  const port = parsePort(inUrl.searchParams.get('port'))
  if (!port) return new Response('invalid or missing port', { status: 400 })

  inUrl.searchParams.delete('port')
  const qs = inUrl.searchParams.toString()
  const wsUrl = `ws://127.0.0.1:${port}${inUrl.pathname}${qs ? `?${qs}` : ''}`

  const { socket, response } = Deno.upgradeWebSocket(req)
  const upstream = new WebSocket(wsUrl)

  const pumpUp = (ev: MessageEvent) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(ev.data)
  }
  const pumpDown = (ev: MessageEvent) => {
    if ((socket as WebSocket).readyState === WebSocket.OPEN) {
      ;(socket as WebSocket).send(ev.data)
    }
  }

  socket.onmessage = pumpUp
  upstream.onmessage = pumpDown

  const close = () => {
    try {
      socket.close()
    } catch (_) {}
    try {
      upstream.close()
    } catch (_) {}
  }
  socket.onerror = close
  upstream.onerror = close
  socket.onclose = close
  upstream.onclose = close

  return response
}

export function createApp(opts: ProxyOptions = {}) {
  const app = new Hono()

  app.all('*', (c) => {
    const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
    if (isWS) return proxyWS(c.req.raw)
    return proxyHTTP(c.req.raw, opts)
  })

  return app
}

export type App = ReturnType<typeof createApp>
