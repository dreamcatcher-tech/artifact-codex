import { expect } from '@std/expect'
import { createApp } from './main.ts'
import NodeWS from 'ws'

function startHTTPUpstream(port: number) {
  const ac = new AbortController()
  const srv = Deno.serve(
    { hostname: '127.0.0.1', port, signal: ac.signal },
    (req) => {
      const u = new URL(req.url)
      const body = `HTTP-${port}:${u.pathname}${u.search}`
      return new Response(body, { headers: { 'content-type': 'text/plain' } })
    },
  )
  return { close: () => ac.abort(), srv }
}

function startWSUpstream(port: number) {
  const ac = new AbortController()
  const sockets = new Set<WebSocket>()
  const srv = Deno.serve(
    { hostname: '127.0.0.1', port, signal: ac.signal },
    (req) => {
      const { socket, response } = Deno.upgradeWebSocket(req)
      sockets.add(socket as unknown as WebSocket)
      socket.onopen = () => {
        try {
          socket.send(`WS-READY-${port}`)
        } catch {
          // ignore
        }
      }
      socket.onmessage = (e: MessageEvent) => {
        console.log('ws upstream got', e.data)
        if (typeof e.data === 'string') socket.send(`ECHO-${port}:${e.data}`)
      }
      socket.onclose = () => {
        try {
          sockets.delete(socket as unknown as WebSocket)
        } catch {
          // ignore
        }
      }
      socket.onerror = () => {
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
      return response
    },
  )
  return {
    close: () => {
      for (const s of sockets) {
        try {
          s.close(1000)
        } catch {
          // ignore
        }
      }
      ac.abort()
    },
    srv,
  }
}

function randomPort(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

Deno.test('ci-e2e: HTTP routing via Fly-Forwarded-Port', async () => {
  const HTTP_PORT = randomPort(30500, 30600)
  const LISTEN = 18080
  const upstream = startHTTPUpstream(HTTP_PORT)
  const { app } = createApp()
  const ac = new AbortController()
  const srv = Deno.serve({
    hostname: '127.0.0.1',
    port: LISTEN,
    signal: ac.signal,
  }, app.fetch)
  try {
    const res = await fetch(`http://127.0.0.1:${LISTEN}/hello?x=1`, {
      headers: { 'Fly-Forwarded-Port': String(HTTP_PORT) },
    })
    const text = await res.text()
    expect(text).toBe(`HTTP-${HTTP_PORT}:/hello?x=1`)
  } finally {
    upstream.close()
    ac.abort()
    await srv.finished
  }
})

Deno.test('ci-e2e: WebSocket routing via Fly-Forwarded-Port', async () => {
  const WS_PORT = randomPort(30650, 30750)
  const LISTEN = 18081
  const upstream = startWSUpstream(WS_PORT)
  const { app } = createApp()
  const ac = new AbortController()
  const srv = Deno.serve({
    hostname: '127.0.0.1',
    port: LISTEN,
    signal: ac.signal,
  }, app.fetch)
  try {
    const ws = new NodeWS(`ws://127.0.0.1:${LISTEN}/ws`, [], {
      headers: { 'Fly-Forwarded-Port': String(WS_PORT) },
      perMessageDeflate: false,
    })
    const firstMsg = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws timeout')), 2000)
      ws.once('message', (data: NodeWS.RawData) => {
        clearTimeout(timer)
        resolve(
          typeof data === 'string' ? data : new TextDecoder().decode(data),
        )
      })
      ws.once('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
      ws.on('open', () => ws.send('hello'))
    })
    const ready = `WS-READY-${WS_PORT}`
    const echo = `ECHO-${WS_PORT}:hello`
    expect([ready, echo]).toContain(firstMsg)
    ws.close()
    await new Promise((r) => ws.once('close', r))
  } finally {
    upstream.close()
    ac.abort()
    await srv.finished
  }
})
