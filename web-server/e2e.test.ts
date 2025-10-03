import { expect } from '@std/expect'
import { findAvailablePort, HOST } from '@artifact/shared'
import { createAgentWebServer } from './mod.ts'
import { createTestServerOptions } from './test-helpers.ts'
import NodeWS from 'ws'

function safe<T>(fn: () => T) {
  return () => {
    try {
      fn()
    } catch {
      // ignore
    }
  }
}

function serveOn(
  port: number,
  handler: Deno.ServeHandler,
  close?: () => Promise<void>,
) {
  const ac = new AbortController()
  const srv = Deno.serve(
    { hostname: HOST, port, signal: ac.signal },
    handler,
  )
  return {
    [Symbol.asyncDispose]: async () => {
      ac.abort()
      if (close) {
        await close()
      }
      return srv.finished
    },
  }
}

function startApp(listen: number) {
  const { app, close } = createAgentWebServer(createTestServerOptions())
  return serveOn(listen, app.fetch, close)
}

function startHTTPEcho(port: number) {
  return serveOn(port, (req) => {
    const u = new URL(req.url)
    const body = `HTTP-${port}:${u.pathname}${u.search}`
    return new Response(body, { headers: { 'content-type': 'text/plain' } })
  })
}

function startWSEcho(port: number) {
  const sockets = new Set<WebSocket>()
  return serveOn(
    port,
    (req) => {
      const { socket, response } = Deno.upgradeWebSocket(req)
      const ws = socket as unknown as WebSocket
      sockets.add(ws)
      ws.onopen = safe(() => ws.send(`WS-READY-${port}`))
      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') {
          safe(() => ws.send(`ECHO-${port}:${e.data}`))()
        }
      }
      ws.onclose = safe(() => sockets.delete(ws))
      ws.onerror = safe(() => ws.close())
      return response
    },
    async () => {
      const pending: Promise<void>[] = []
      for (const socket of sockets) {
        const closePromise = new Promise<void>((resolve) => {
          socket.addEventListener('close', () => resolve(), { once: true })
        })
        pending.push(closePromise)
        safe(() => socket.close(1000))()
      }
      await Promise.allSettled(pending)
    },
  )
}

async function firstMessage(ws: NodeWS, timeoutMs = 2000): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws timeout')), timeoutMs)
    const cleanup = () => clearTimeout(timer)
    ws.once('message', (data: NodeWS.RawData) => {
      cleanup()
      const text = typeof data === 'string'
        ? data
        : new TextDecoder().decode(data as Uint8Array)
      resolve(text)
    })
    ws.once('error', (err: Error) => {
      cleanup()
      reject(err)
    })
  })
}

Deno.test('ci-e2e: HTTP routing via Fly-Forwarded-Port', async () => {
  const HTTP_PORT = await findAvailablePort({
    min: 30500,
    max: 30600,
    hostname: HOST,
  })
  const LISTEN = 18080
  await using _upstream = startHTTPEcho(HTTP_PORT)
  await using _appSrv = startApp(LISTEN)

  const res = await fetch(`http://${HOST}:${LISTEN}/hello?x=1`, {
    headers: { 'Fly-Forwarded-Port': String(HTTP_PORT) },
  })
  const text = await res.text()
  expect(text).toBe(`HTTP-${HTTP_PORT}:/hello?x=1`)
})

Deno.test('ci-e2e: WebSocket routing via Fly-Forwarded-Port', async () => {
  const WS_PORT = await findAvailablePort({
    min: 30650,
    max: 30750,
    hostname: HOST,
  })
  const LISTEN = 18081
  await using _upstream = startWSEcho(WS_PORT)
  await using _appSrv = startApp(LISTEN)
  const ws = new NodeWS(`ws://${HOST}:${LISTEN}/ws`, [], {
    headers: { 'Fly-Forwarded-Port': String(WS_PORT) },
    perMessageDeflate: false,
  })
  ws.on('open', () => ws.send('hello'))
  const firstMsg = await firstMessage(ws)
  const ready = `WS-READY-${WS_PORT}`
  const echo = `ECHO-${WS_PORT}:hello`
  expect([ready, echo]).toContain(firstMsg)
  ws.close()
  await new Promise((r) => ws.once('close', r))
})
