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

// In-VM router: rely only on Fly-Forwarded-Port

function parsePort(v: string | null): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

function stripHopByHop(h: Headers) {
  for (const k of HOP_BY_HOP) h.delete(k)
}

// No cookie or query param routing

function portFromHeaders(h: Headers): number | null {
  return parsePort(h.get('fly-forwarded-port'))
}

export async function proxyHTTP(req: Request): Promise<Response> {
  const inUrl = new URL(req.url)
  const port = portFromHeaders(req.headers)
  if (!port) return new Response('missing fly-forwarded-port', { status: 400 })

  const qs = inUrl.searchParams.toString()
  const target = new URL(
    `${inUrl.pathname}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:${port}`,
  )

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

  try {
    const upstreamRes = await fetch(target, forwardInit)
    const outHeaders = new Headers(upstreamRes.headers)
    stripHopByHop(outHeaders)
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: outHeaders,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const lower = msg.toLowerCase()
    let status = 502
    if (lower.includes('timeout') || lower.includes('timed out')) status = 504
    const body =
      `Proxy to 127.0.0.1:${port} for ${req.method} ${inUrl.pathname}${inUrl.search} failed: ${msg}`
    const headers = new Headers({
      'content-type': 'text/plain; charset=utf-8',
      'x-proxy-error': 'fetch-failed',
    })
    return new Response(body, { status, headers })
  }
}

export function proxyWS(req: Request): Response {
  const inUrl = new URL(req.url)
  const port = portFromHeaders(req.headers)
  if (!port) return new Response('missing fly-forwarded-port', { status: 400 })

  const qs = inUrl.searchParams.toString()
  const isSecure = inUrl.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  const wsUrl = `${scheme}://127.0.0.1:${port}${inUrl.pathname}${
    qs ? `?${qs}` : ''
  }`

  console.log('proxyWS', wsUrl)

  const requestedProtocols = req.headers.get('sec-websocket-protocol')
  const protocols = requestedProtocols
    ? requestedProtocols.split(',').map((p) => p.trim()).filter(Boolean)
    : undefined
  const selectedProtocol = protocols?.[0]

  let socket: WebSocket
  let response: Response
  try {
    ;({ socket, response } = Deno.upgradeWebSocket(
      req,
      selectedProtocol ? { protocol: selectedProtocol } : undefined,
    ))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      `WebSocket upgrade failed for ${inUrl.pathname}${inUrl.search}: ${msg}`,
      { status: 400 },
    )
  }

  let upstream: WebSocket
  try {
    upstream = new WebSocket(wsUrl, protocols as string[] | undefined)
  } catch (err) {
    try {
      socket.close(1011)
    } catch {
      // ignore
    }
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      `WebSocket connect to ${wsUrl} failed: ${msg}`,
      { status: 502 },
    )
  }

  const pumpUp = (ev: MessageEvent) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(ev.data)
  }
  const pumpDown = (ev: MessageEvent) => {
    if ((socket as WebSocket).readyState === WebSocket.OPEN) {
      ;(socket as WebSocket).send(ev.data)
    }
  }

  socket.onopen = () => console.log('client ws open')
  upstream.onopen = () => console.log('upstream ws open')
  socket.onmessage = pumpUp
  upstream.onmessage = pumpDown

  const closeBoth = (code?: number, reason?: string) => {
    try {
      socket.close(code, reason)
    } catch {
      // ignore
    }
    try {
      upstream.close(code, reason)
    } catch {
      // ignore
    }
  }

  socket.onerror = (e) => {
    console.error('client ws error', e)
    closeBoth(1011)
  }
  upstream.onerror = (e) => {
    console.error('upstream ws error', e)
    closeBoth(1011)
  }
  socket.onclose = (ev: CloseEvent) => {
    console.log('client ws close', ev.code, ev.reason)
    closeBoth(ev.code, ev.reason)
  }
  upstream.onclose = (ev: CloseEvent) => {
    console.log('upstream ws close', ev.code, ev.reason)
    closeBoth(ev.code, ev.reason)
  }

  return response
}
