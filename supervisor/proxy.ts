import { type Debugger } from 'debug'
import { HOST, type IdleTrigger } from '@artifact/shared'

type ActivityKind = 'http' | 'ws'
type ActivityObserver =
  | IdleTrigger
  | ((kind: ActivityKind, detail: string) => void)
type WebSocketData = Parameters<WebSocket['send']>[0]

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

const CLERK_COOKIE_NAMES = new Set([
  '__client',
  '__client_uat',
  '__session',
  '__clerk_db_jwt',
  '__clerk_handshake',
])

const CLERK_COOKIE_PREFIXES = ['__clerk']

function isClerkCookie(name: string) {
  const lowered = name.trim().toLowerCase()
  if (!lowered) return false
  return (
    CLERK_COOKIE_NAMES.has(lowered) ||
    CLERK_COOKIE_PREFIXES.some((prefix) => lowered.startsWith(prefix))
  )
}

function stripClerkCookies(headers: Headers) {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) return
  const kept = cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => {
      const eqIndex = segment.indexOf('=')
      const name = eqIndex === -1 ? segment : segment.slice(0, eqIndex)
      return !isClerkCookie(name)
    })
  if (kept.length === 0) {
    headers.delete('cookie')
  } else {
    headers.set('cookie', kept.join('; '))
  }
}

function stripClerkSetCookies(headers: Headers) {
  const values: string[] = []
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      values.push(value)
    }
  })
  if (values.length === 0) return
  headers.delete('set-cookie')
  for (const value of values) {
    const [cookiePart] = value.split(';', 1)
    const eqIndex = cookiePart.indexOf('=')
    const name = eqIndex === -1 ? cookiePart : cookiePart.slice(0, eqIndex)
    if (!isClerkCookie(name)) {
      headers.append('set-cookie', value)
    }
  }
}

function reportActivity(
  observer: ActivityObserver | undefined,
  kind: ActivityKind,
  detail: string,
) {
  if (typeof observer !== 'function') return
  try {
    observer(kind, detail)
  } catch {
    // ignore
  }
}

function beginActivity(
  observer: ActivityObserver | undefined,
  kind: ActivityKind,
  detail: string,
) {
  reportActivity(observer, kind, detail)
  if (!observer || typeof observer === 'function') {
    return () => {}
  }
  const id = observer.busy()
  let done = false
  return () => {
    if (done) return
    done = true
    try {
      observer.idle(id)
    } catch {
      // ignore
    }
  }
}

export async function proxyHTTP(
  req: Request,
  port: number,
  log: Debugger,
  activity?: ActivityObserver,
): Promise<Response> {
  log = log.extend('proxyHTTP')
  const inUrl = new URL(req.url)
  if (!port) return new Response('missing fly-forwarded-port', { status: 400 })

  const qs = inUrl.searchParams.toString()
  const target = new URL(
    `${inUrl.pathname}${qs ? `?${qs}` : ''}`,
    `http://${HOST}:${port}`,
  )

  const fwdHeaders = new Headers(req.headers)
  stripHopByHop(fwdHeaders)
  fwdHeaders.set('host', `${HOST}:${port}`)
  const xf = req.headers.get('x-forwarded-for')
  const clientIP = req.headers.get('x-real-ip') ?? ''
  fwdHeaders.set('x-forwarded-for', xf ? `${xf}, ${clientIP}` : clientIP)
  fwdHeaders.set('x-forwarded-proto', inUrl.protocol.replace(':', ''))
  fwdHeaders.set('x-forwarded-host', inUrl.host)
  fwdHeaders.set('via', '1.1 hono-deno')
  stripClerkCookies(fwdHeaders)

  const forwardInit: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    body: req.body,
    redirect: 'manual',
  }

  log(
    'HTTP proxy -> %s %s (to %s)',
    req.method,
    inUrl.pathname + inUrl.search,
    String(target),
  )

  const endActivity = beginActivity(
    activity,
    'http',
    `${req.method.toUpperCase()} ${inUrl.pathname}`,
  )
  try {
    const upstreamRes = await fetch(target, forwardInit)
    reportActivity(
      activity,
      'http',
      `response ${upstreamRes.status} ${inUrl.pathname}`,
    )
    log('HTTP proxy <- %d %s', upstreamRes.status, upstreamRes.statusText)
    const outHeaders = new Headers(upstreamRes.headers)
    stripHopByHop(outHeaders)
    stripClerkSetCookies(outHeaders)
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
      `Proxy to ${HOST}:${port} for ${req.method} ${inUrl.pathname}${inUrl.search} failed: ${msg}`
    const headers = new Headers({
      'content-type': 'text/plain; charset=utf-8',
      'x-proxy-error': 'fetch-failed',
    })
    log('HTTP proxy error: %s', msg)
    reportActivity(activity, 'http', `error ${msg}`)
    return new Response(body, { status, headers })
  } finally {
    endActivity()
  }
}

export function proxyWS(
  req: Request,
  port: number,
  log: Debugger,
  activity?: ActivityObserver,
): Response {
  const inUrl = new URL(req.url)
  if (!port) return new Response('missing fly-forwarded-port', { status: 400 })

  const qs = inUrl.searchParams.toString()
  const isSecure = inUrl.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  const wsUrl = `${scheme}://${HOST}:${port}${inUrl.pathname}${
    qs ? `?${qs}` : ''
  }`

  log('WS proxy -> %s', wsUrl)
  const endActivity = beginActivity(activity, 'ws', `upgrade ${inUrl.pathname}`)
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    endActivity()
  }

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
    log('WS upgrade failed for %s%s: %s', inUrl.pathname, inUrl.search, msg)
    reportActivity(activity, 'ws', `upgrade failed ${msg}`)
    finish()
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
    log('WS connect failed to %s: %s', wsUrl, msg)
    reportActivity(activity, 'ws', `connect failed ${msg}`)
    finish()
    return new Response(
      `WebSocket connect to ${wsUrl} failed: ${msg}`,
      { status: 502 },
    )
  }

  const upstreamQueue: WebSocketData[] = []
  const clientQueue: WebSocketData[] = []

  const flushUpstream = () => {
    if (upstream.readyState !== WebSocket.OPEN) return
    while (upstreamQueue.length) {
      const next = upstreamQueue.shift()!
      upstream.send(next)
    }
  }

  const flushClient = () => {
    if ((socket as WebSocket).readyState !== WebSocket.OPEN) return
    while (clientQueue.length) {
      const next = clientQueue.shift()!
      ;(socket as WebSocket).send(next)
    }
  }

  const pumpUp = (ev: MessageEvent) => {
    reportActivity(activity, 'ws', 'client->upstream message')
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(ev.data)
      return
    }
    if (upstream.readyState === WebSocket.CONNECTING) {
      upstreamQueue.push(ev.data)
    }
  }

  const pumpDown = (ev: MessageEvent) => {
    reportActivity(activity, 'ws', 'upstream->client message')
    const client = socket as WebSocket
    if (client.readyState === WebSocket.OPEN) {
      client.send(ev.data)
      return
    }
    if (client.readyState === WebSocket.CONNECTING) {
      clientQueue.push(ev.data)
    }
  }

  socket.binaryType = 'arraybuffer'
  upstream.binaryType = 'arraybuffer'

  socket.onopen = () => {
    log('client ws open')
    reportActivity(activity, 'ws', 'client open')
    flushClient()
  }
  upstream.onopen = () => {
    log('upstream ws open')
    reportActivity(activity, 'ws', 'upstream open')
    flushUpstream()
  }
  socket.onmessage = pumpUp
  upstream.onmessage = pumpDown

  socket.onerror = (e) => {
    log('client ws error %o', e)
    reportActivity(activity, 'ws', 'client error')
    closeBoth(1011)
  }
  upstream.onerror = (e) => {
    log('upstream ws error %o', e)
    reportActivity(activity, 'ws', 'upstream error')
    closeBoth(1011)
  }
  socket.onclose = (ev: CloseEvent) => {
    log('client ws close %d %s', ev.code, ev.reason)
    reportActivity(activity, 'ws', 'client close')
    closeBoth(ev.code, ev.reason)
  }
  upstream.onclose = (ev: CloseEvent) => {
    log('upstream ws close %d %s', ev.code, ev.reason)
    reportActivity(activity, 'ws', 'upstream close')
    closeBoth(ev.code, ev.reason)
  }

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
    finish()
  }

  return response
}
