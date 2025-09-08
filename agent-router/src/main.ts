import { Hono } from '@hono/hono'
import { prettyJSON } from '@hono/hono/pretty-json'
import { HTTPException } from '@hono/hono/http-exception'
import { deleteCookie, getCookie, setCookie } from '@hono/hono/cookie'

import { BASE_DOMAIN, DEFAULT_HOME_AGENT, ROUTER_VERSION } from './config.ts'
import { parseHost } from './utils/host.ts'
import { resolveAlias, resolveUserHome } from './clients/artifact.ts'
import { lookupTarget } from './clients/registry.ts'
import { createFace, getFace, listFaces } from './faces.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'

const app = new Hono<{ Variables: { userId?: string; hostInfo?: ReturnType<typeof parseHost> } }>()

// Middleware: prettify JSON in dev
app.use('*', prettyJSON())

// Middleware: capture host info
app.use('*', async (c: any, next: any) => {
  const hostInfo = parseHost(c.req.header('host'))
  c.set('hostInfo', hostInfo)
  await next()
})

// Middleware: very basic dev auth
// - Header x-user-id: <id> marks user as authed
// - Cookie uid is also respected
app.use('*', async (c: any, next: any) => {
  const h = c.req.header('x-user-id')
  const cookieUid = getCookie(c, 'uid')
  const userId = h || cookieUid || undefined
  if (userId) setCookie(c, 'uid', userId, { path: '/', httpOnly: false })
  if (userId) c.set('userId', userId)
  await next()
})

// Health endpoints
app.get('/_healthz', (c: any) => c.json({ ok: true }))
app.get('/_readyz', (c: any) => c.json({ ready: true }))
app.get('/_version', (c: any) => c.json({ version: ROUTER_VERSION }))

// Auth helpers (dev)
app.get('/auth/me', (c: any) => {
  const userId = c.get('userId')
  return c.json({ authed: Boolean(userId), userId: userId ?? null })
})

app.get('/logout', (c: any) => {
  deleteCookie(c, 'uid', { path: '/' })
  return c.redirect('/', 302)
})

app.get('/auth/callback', (c: any) => c.text('auth callback stub'))

// Base domain: root
app.get('/', async (c: any) => {
  const { isBase } = c.get('hostInfo')!
  if (!isBase) return c.redirect('/', 302) // Normalize to base host root if misrouted
  const userId = c.get('userId')
  if (userId) {
    const home = await resolveUserHome(userId)
    if (home?.host) {
      const url = new URL(c.req.url)
      url.protocol = 'https:'
      url.host = `${home.host}.${BASE_DOMAIN}`
      url.pathname = `/${DEFAULT_HOME_AGENT}`
      return c.redirect(url.toString(), 302)
    }
  }
  // Guest or no home yet → concierge/home-agent on base domain
  return c.redirect(`/${DEFAULT_HOME_AGENT}`, 302)
})

// Base domain: alias home-agent → concierge
app.get('/home-agent', (c: any) => c.redirect('/concierge', 302))

// Base domain: concierge page
app.get('/concierge', async (c: any) => {
  const { isBase } = c.get('hostInfo')!
  if (!isBase) throw new HTTPException(404, { message: 'Not found' })
  const url = new URL(c.req.url)
  const face = url.searchParams.get('face')
  if (!face) {
    const f = createFace('concierge')
    url.searchParams.set('face', f.id)
    return c.redirect(url.toString(), 302)
  }
  if (!getFace(face)) return c.redirect('/concierge', 302)
  return sendFile(c, 'agent.html')
})

// Faces index (base domain agents)
app.get('/:agent/faces', (c: any) => {
  const { isBase } = c.get('hostInfo')!
  if (!isBase) throw new HTTPException(404, { message: 'Not found' })
  const agent = c.req.param('agent')
  return c.json({
    agent,
    faces: listFaces(agent).map((f) => ({ id: f.id, createdAt: f.createdAt })),
  })
})

// Alias: /sessions
app.get('/:agent/sessions', (c: any) => {
  const { isBase } = c.get('hostInfo')!
  if (!isBase) throw new HTTPException(404, { message: 'Not found' })
  const agent = c.req.param('agent')
  return c.json({
    agent,
    faces: listFaces(agent).map((f) => ({ id: f.id, createdAt: f.createdAt })),
  })
})

// Catch garbage on base domain
app.all('*', async (c: any, next: any) => {
  const { isBase } = c.get('hostInfo')!
  if (!isBase) return next()
  // Unknown paths on base domain redirect to root
  if (
    c.req.path !== '/' &&
    !c.req.path.startsWith('/_') &&
    !c.req.path.startsWith('/auth') &&
    !c.req.path.startsWith('/assets/') &&
    !c.req.path.startsWith('/tty') &&
    c.req.path !== '/ws' &&
    c.req.path !== '/token'
  ) {
    return c.redirect('/', 302)
  }
  return next()
})

// App host routing — use a sub-app-like handler gated by host
app.all('*', async (c: any, next: any) => {
  const { isBase, appSubdomain, host } = c.get('hostInfo')!
  if (isBase || !appSubdomain) return next()
  if (
    c.req.path.startsWith('/assets/') ||
    c.req.path.startsWith('/tty') ||
    c.req.path === '/ws' ||
    c.req.path === '/token'
  ) {
    return next()
  }

  // Resolve app status
  const res = await resolveAlias(host)
  if (res.status === 'invalid' || !res.app) {
    return c.redirect(`https://${BASE_DOMAIN}/`, 302)
  }
  if (res.status === 'maintenance') {
    return sendFile(c, 'maintenance.html')
  }

  // Normalize and lookup target for path
  const userId = c.get('userId')
  const lookup = await lookupTarget(host, c.req.path, userId)

  // Ensure face param
  const url = new URL(c.req.url)
  let face = url.searchParams.get('face')
  if (!face) {
    const f = createFace(lookup.agentPath)
    url.searchParams.set('face', f.id)
    return c.redirect(url.toString(), 302)
  }
  if (!getFace(face)) {
    // face not found → start a new one
    const f = createFace(lookup.agentPath)
    url.searchParams.set('face', f.id)
    return c.redirect(url.toString(), 302)
  }

  // Faces index on app host
  if (c.req.path.endsWith('/faces')) {
    return c.json({ agent: lookup.agentPath, faces: listFaces(lookup.agentPath) })
  }

  // Attach phase: render agent page with embedded ttyd iframe
  return sendFile(c, 'agent.html')
})

// 404 fallback
app.notFound((c: any) => c.text('not found', 404))

// Static file helpers (serve standalone HTML/JS assets)
const PUBLIC_ROOT = new URL('../public/', import.meta.url)

const contentType = (path: string) => {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

const sendFile = async (c: any, relativePath: string) => {
  const url = new URL(relativePath, PUBLIC_ROOT)
  const data = await Deno.readFile(url)
  return new Response(data, { headers: { 'content-type': contentType(relativePath) } })
}

// Serve assets: /assets/* from public/assets
app.get('/assets/*', async (c: any) => {
  const path = c.req.path.replace(/^\/+/, '')
  const assetRel = path.replace(/^assets\//, 'assets/')
  return sendFile(c, assetRel)
})

// Serve a simple browser-based MCP server demo
app.get('/mcp', (c: any) => sendFile(c, 'mcp-server.html'))

// Reverse proxy to a ttyd instance for testing
// - HTTP: /tty and /tty/* → https://codex-rs.fly.dev/
// - WS:   /tty/ws → wss://codex-rs.fly.dev/ws
app.all('/tty', async (c: any) => {
  const upgrade = c.req.header('upgrade')
  if (upgrade && upgrade.toLowerCase() === 'websocket') return proxyWS(c.req.raw)
  return proxyHTTP(c.req.raw)
})
app.all('/tty/*', async (c: any) => {
  const upgrade = c.req.header('upgrade')
  if (upgrade && upgrade.toLowerCase() === 'websocket') return proxyWS(c.req.raw)
  return proxyHTTP(c.req.raw)
})

// ttyd may connect to /ws and /token on the same origin
app.all('/ws', (c: any) => {
  const upgrade = c.req.header('upgrade')
  if (upgrade && upgrade.toLowerCase() === 'websocket') return proxyWS(c.req.raw)
  return proxyHTTP(c.req.raw)
})
app.all('/token', (c: any) => proxyHTTP(c.req.raw))

// (MCP sub-app removed; using stdio MCP server elsewhere)

// Start server
const port = Number(Deno.env.get('PORT') ?? '8080')
export default app
if (import.meta.main) {
  Deno.serve({ port }, app.fetch)
  // deno-lint-ignore no-console
  console.log(`[router] listening on :${port}, base=${BASE_DOMAIN}`)
}
