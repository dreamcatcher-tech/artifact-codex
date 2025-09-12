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

const COOKIE_TARGET = '__proxy_target'

function parsePort(v: string | null): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

function stripHopByHop(h: Headers) {
  for (const k of HOP_BY_HOP) h.delete(k)
}

function readCookie(h: Headers, name: string): string | null {
  const raw = h.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.split('=')
    if (k && k.trim() === name) return rest.join('=').trim()
  }
  return null
}

type TargetCookie = {
  port: number
  mountPath: string
  upstreamBasePath: string
}

function parseTargetCookie(h: Headers): TargetCookie | null {
  const v = readCookie(h, COOKIE_TARGET)
  if (!v) return null
  if (!v.startsWith('v1,')) return null
  const parts = v.split(',')
  if (parts.length < 4) return null
  const port = Number(parts[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const mountPath = decodeURIComponent(parts[2] ?? '') || '/'
  const upstreamBasePath = decodeURIComponent(parts[3] ?? '') || '/'
  return { port, mountPath, upstreamBasePath }
}

function encodeTargetCookie(t: TargetCookie, secure: boolean): string {
  const val = `v1,${t.port},${encodeURIComponent(t.mountPath)},${
    encodeURIComponent(t.upstreamBasePath)
  }`
  return `${COOKIE_TARGET}=${val}; Path=/; HttpOnly; SameSite=Lax${
    secure ? '; Secure' : ''
  }`
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s
}

function ensureLeadingSlash(s: string): string {
  return s.startsWith('/') ? s : `/${s}`
}

function relativeFromMount(pathname: string, mountPath: string): string {
  if (mountPath === '/') return stripLeadingSlash(pathname)
  if (pathname === mountPath) return ''
  const mp = mountPath.endsWith('/') ? mountPath : `${mountPath}/`
  if (pathname.startsWith(mp)) {
    return stripLeadingSlash(pathname.slice(mp.length))
  }
  return stripLeadingSlash(pathname)
}

function joinPaths(base: string, rel: string): string {
  const left = base === '/' ? '' : base
  const right = stripLeadingSlash(rel)
  const joined = `${left}/${right}`
  return ensureLeadingSlash(joined.replace(/\/+/, '/'))
}

export async function proxyHTTP(req: Request): Promise<Response> {
  const inUrl = new URL(req.url)
  const tc = parseTargetCookie(req.headers)
  const cookiePresent = !!tc
  const port = tc?.port ?? parsePort(inUrl.searchParams.get('port'))
  if (!port) return new Response('invalid or missing port', { status: 400 })

  inUrl.searchParams.delete('port')
  const qs = inUrl.searchParams.toString()
  const targetPath = cookiePresent
    ? joinPaths(
      tc!.upstreamBasePath,
      relativeFromMount(inUrl.pathname, tc!.mountPath),
    )
    : inUrl.pathname
  const target = new URL(
    `${targetPath}${qs ? `?${qs}` : ''}`,
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

  const upstreamRes = await fetch(target, forwardInit)
  const outHeaders = new Headers(upstreamRes.headers)
  stripHopByHop(outHeaders)
  if (inUrl.searchParams.has('port')) {
    const secure = inUrl.protocol === 'https:'
    const cookie = encodeTargetCookie(
      { port, mountPath: inUrl.pathname, upstreamBasePath: inUrl.pathname },
      secure,
    )
    outHeaders.append('set-cookie', cookie)
  }
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  })
}

export function proxyWS(req: Request): Response {
  const inUrl = new URL(req.url)
  const tc = parseTargetCookie(req.headers)
  const cookiePresent = !!tc
  const port = tc?.port ?? parsePort(inUrl.searchParams.get('port'))
  if (!port) return new Response('invalid or missing port', { status: 400 })

  inUrl.searchParams.delete('port')
  const qs = inUrl.searchParams.toString()
  const isSecure = inUrl.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  const targetPath = cookiePresent
    ? joinPaths(
      tc!.upstreamBasePath,
      relativeFromMount(inUrl.pathname, tc!.mountPath),
    )
    : inUrl.pathname
  const wsUrl = `${scheme}://127.0.0.1:${port}${targetPath}${
    qs ? `?${qs}` : ''
  }`

  console.log('proxyWS', wsUrl)

  const requestedProtocols = req.headers.get('sec-websocket-protocol')
  const protocols = requestedProtocols
    ? requestedProtocols.split(',').map((p) => p.trim()).filter(Boolean)
    : undefined
  const selectedProtocol = protocols?.[0]

  const { socket, response } = Deno.upgradeWebSocket(
    req,
    selectedProtocol ? { protocol: selectedProtocol } : undefined,
  )

  const upstream = new WebSocket(wsUrl, protocols as string[] | undefined)

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
