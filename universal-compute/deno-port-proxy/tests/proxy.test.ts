import { Hono } from 'jsr:@hono/hono'
import { assertEquals, assert } from 'jsr:@std/assert'
import { createApp, type LocalResolver } from '../src/app.ts'

function upstreamEcho(label: string) {
  const app = new Hono()
  app.all('*', async (c) => {
    const url = new URL(c.req.url)
    const bodyText = await c.req.text().catch(() => '')
    const info = {
      who: label,
      method: c.req.method,
      path: url.pathname,
      search: url.search,
      host: c.req.header('host') ?? null,
      connection: c.req.header('connection') ?? null,
      body: bodyText,
      headers: Object.fromEntries(c.req.raw.headers),
    }
    return c.json(info)
  })
  return app
}

function makeResolver(map: Map<number, Hono>): LocalResolver {
  return (port: number) => {
    const app = map.get(port)
    if (!app) return undefined
    return (req: Request) => app.fetch(req)
  }
}

Deno.test('proxies GET and strips port param', async () => {
  const registry = new Map<number, Hono>()
  registry.set(23423, upstreamEcho('u1'))
  const app = createApp({ resolveLocal: makeResolver(registry) })

  const res = await app.request('http://proxy.local/hello/world?port=23423&x=1&y=2')
  assertEquals(res.status, 200)
  const json = await res.json()

  assertEquals(json.who, 'u1')
  assertEquals(json.method, 'GET')
  assertEquals(json.path, '/hello/world')
  // port removed; other params preserved
  assertEquals(json.search, '?x=1&y=2')
  // Host rewritten to target port
  assertEquals(json.host, '127.0.0.1:23423')
})

Deno.test('proxies POST body and strips hop-by-hop headers', async () => {
  const registry = new Map<number, Hono>()
  registry.set(3000, upstreamEcho('echo'))
  const app = createApp({ resolveLocal: makeResolver(registry) })

  const res = await app.request('http://proxy.local/api?port=3000', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      connection: 'keep-alive', // should be stripped
    },
    body: 'hello-world',
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.method, 'POST')
  assertEquals(json.path, '/api')
  assertEquals(json.body, 'hello-world')
  // hop-by-hop header should not reach upstream
  assertEquals(json.connection, null)
})

Deno.test('400 on missing or invalid port', async () => {
  const app = createApp({ resolveLocal: () => undefined })
  let res = await app.request('http://proxy.local/nope')
  assertEquals(res.status, 400)
  res = await app.request('http://proxy.local/nope?port=abc')
  assertEquals(res.status, 400)
})

