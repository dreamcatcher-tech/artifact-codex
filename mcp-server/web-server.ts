import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { type Context, type ErrorHandler, Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { cors } from 'hono/cors'
import { poweredBy } from 'hono/powered-by'
import { secureHeaders } from 'hono/secure-headers'
import { ulid } from 'ulid'

import { createMcpServer } from './server.ts'
import { LIVE_LOG_PATH } from './codex-runner.ts'

type McpSession = { server: McpServer; transport: StreamableHTTPTransport }

type TypedContext = {
  Bindings: {
    sessions: Map<string, McpSession>
    apiKeys: Set<string>
  }
}

// Env toggle to disable auth globally
const isAuthDisabled = () => {
  const v =
    Deno.env.get('MCP_DISABLE_AUTH') || Deno.env.get('DISABLE_AUTH') || ''
  return /^(1|true|yes|on)$/i.test(v)
}

// Basic API-key auth middleware (no-op if no keys configured or disabled)
const authApiKey = (keys: Set<string>) =>
  createMiddleware<TypedContext>(async (c, next) => {
    if (isAuthDisabled() || !keys || keys.size === 0) return next()
    const header = c.req.header('authorization') || ''
    const token = header.replace(/^Bearer\s+/i, '').trim()
    if (!token || !keys.has(token)) {
      return c.text('Unauthorized', 401)
    }
    return next()
  })

const setup = (
  sessions: Map<string, McpSession>,
  apiKeys: Set<string>,
) =>
  createMiddleware<TypedContext>(async (c, next) => {
    c.env = { sessions, apiKeys }
    return next()
  })

const mcpHandler = createMiddleware<TypedContext>(async (c) => {
  const sessionId = c.req.header('mcp-session-id')

  if (sessionId && c.env.sessions.has(sessionId)) {
    const { transport } = c.env.sessions.get(sessionId)!
    return transport.handleRequest(c)
  } else if (!sessionId && isInitializeRequest(await c.req.json())) {
    const server = await createMcpServer()
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: () => ulid(),
      onsessioninitialized: (sid) => {
        c.env.sessions.set(sid, { server, transport })
      },
    })

    transport.onclose = () => {
      const sid = transport.sessionId
      if (sid && c.env.sessions.has(sid)) {
        c.env.sessions.delete(sid)
      }
    }

    await server.connect(transport)
    return transport.handleRequest(c)
  }

  return c.text(
    sessionId ? 'Session not found' : 'Bad Request',
    sessionId ? 404 : 400,
  )
})

const error: ErrorHandler = function (error: Error, c: Context<TypedContext>) {
  return c.json({ error: error.message }, 500)
}

const preferMachine = (machineId?: string) =>
  createMiddleware<TypedContext>(async (c, next) => {
    const currentId = machineId
    if (!currentId) return next()

    const preferred = c.req.header('fly-prefer-instance-id')

    if (preferred && preferred !== currentId) {
      c.header('fly-replay', `instance=${preferred}`)
      return c.body(null, 204)
    }
    return next()
  })

export type ServerGateway = {
  app: Hono<TypedContext>
  close: () => Promise<void>
  sessions: Map<string, McpSession>
  [Symbol.asyncDispose]: () => Promise<void>
}

export const createServer = (
  opts?: { apiKeys?: readonly string[]; machineId?: string },
): ServerGateway => {
  const sessions = new Map<string, McpSession>()
  const envKeys =
    (Deno.env.get('MCP_API_KEYS') || Deno.env.get('MCP_API_KEY') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const apiKeys = new Set([...(opts?.apiKeys ?? []), ...envKeys])

  const app = new Hono<TypedContext>()
    .use(cors({
      origin: '*',
      allowMethods: ['POST', 'GET', 'OPTIONS'],
      allowHeaders: [
        'Authorization',
        'content-type',
        'mcp-session-id',
        'mcp-protocol-version',
        // Allow clients to send a preferred machine id
        'fly-prefer-instance-id',
        'x-machine-id',
        'x-preferred-machine-id',
      ],
      exposeHeaders: [
        'mcp-session-id',
      ],
    }))
    .use(poweredBy(), secureHeaders())
    .use(preferMachine(opts?.machineId))
    .use(setup(sessions, apiKeys))
    // Public live log download (supports Range requests for efficient tailing)
    .get('/live', async (c) => {
      let stat
      try {
        stat = await Deno.stat(LIVE_LOG_PATH)
      } catch {
        return c.text('No live log available', 404)
      }

      const size = stat.size
      const range = c.req.header('range') || c.req.header('Range')

      // Helper to stream from an offset to end
      const streamFrom = async (start: number, end: number | null) => {
        const file = await Deno.open(LIVE_LOG_PATH, { read: true })
        await file.seek(start, Deno.SeekMode.Start)
        const toRead = end == null ? size - start : Math.max(0, end - start + 1)

        let remaining = toRead
        const rs = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (remaining === 0) {
              controller.close()
              file.close()
              return
            }
            const chunkSize = Math.min(64 * 1024, remaining)
            const buf = new Uint8Array(chunkSize)
            const n = await file.read(buf)
            if (n === null) {
              controller.close()
              file.close()
              return
            }
            remaining -= n
            controller.enqueue(buf.subarray(0, n))
            if (remaining === 0) {
              controller.close()
              file.close()
            }
          },
          cancel() {
            try { file.close() } catch {}
          },
        })
        return rs
      }

      const commonHeaders: Record<string, string> = {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': 'inline; filename="live.log"',
        'accept-ranges': 'bytes',
        'x-log-size': String(size),
      }

      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
        let start = startStr ? parseInt(startStr, 10) : 0
        let end = endStr ? parseInt(endStr, 10) : size - 1
        if (Number.isNaN(start)) start = 0
        if (Number.isNaN(end)) end = size - 1

        if (start >= size) {
          return new Response(null, {
            status: 416,
            headers: { ...commonHeaders, 'content-range': `bytes */${size}` },
          })
        }
        if (end >= size) end = size - 1

        const body = await streamFrom(start, end)
        return new Response(body, {
          status: 206,
          headers: {
            ...commonHeaders,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${size}`,
          },
        })
      }

      // Full response (no range)
      const file = await Deno.open(LIVE_LOG_PATH, { read: true })
      return new Response(file.readable, {
        headers: {
          ...commonHeaders,
          'content-length': String(size),
        },
      })
    })
    // Simple terminal view that tails /live
    .get('/view', (c) => {
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Live Stdout</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
    <style>
      html, body { height: 100%; margin: 0; background: #111; color: #ddd; }
      #wrap { display: flex; height: 100%; width: 100%; }
      #term { flex: 1; padding: 8px; }
      .xterm { height: 100%; }
    </style>
  </head>
  <body>
    <div id="wrap"><div id="term"></div></div>
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
    <script>
      (function() {
        const term = new window.Terminal({
          convertEol: true,
          disableStdin: true,
          cursorBlink: false,
          theme: { background: '#111111' },
        })
        term.open(document.getElementById('term'))
        term.writeln('\u001b[1;32mLive log\u001b[0m — tailing /live...')

        let offset = 0
        const decoder = new TextDecoder()

        async function pullOnce() {
          try {
            const headers = offset > 0 ? { Range: 'bytes=' + offset + '-' } : {}
            const res = await fetch('/live', { headers })
            if (res.status === 404) {
              await new Promise(r => setTimeout(r, 800))
              return
            }
            if (res.status === 416) {
              const cr = res.headers.get('content-range') || ''
              const m = cr.match(/\*\/(\d+)/)
              const newSize = m ? Number(m[1]) : 0
              offset = newSize || 0
              await new Promise(r => setTimeout(r, 500))
              return
            }
            const logSize = Number(res.headers.get('x-log-size') || '0') || 0
            const reader = res.body?.getReader()
            if (reader) {
              while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (value && value.length) {
                  offset += value.length
                  term.write(decoder.decode(value, { stream: true }))
                }
              }
              // flush any decoder state
              term.write(decoder.decode())
            } else {
              // Fallback: not streaming
              const buf = await res.arrayBuffer()
              const bytes = new Uint8Array(buf)
              offset = bytes.length
              term.write(decoder.decode(bytes))
            }
            // If server sent full file (200), res.status may be 200; adjust offset
            if (res.status === 200 && logSize && offset > logSize) {
              offset = logSize
            }
          } catch (err) {
            console.error(err)
          }
        }

        async function loop() {
          while (true) {
            await pullOnce()
            await new Promise(r => setTimeout(r, 700))
          }
        }
        loop()
      })()
    </script>
  </body>
</html>`
      return c.html(html)
    })
    .use(authApiKey(apiKeys))
    .all('/mcp', mcpHandler)
    .onError(error)

  const close = async () => {
    await Promise.all(
      Array.from(sessions.values()).map(({ server }) => server.close()),
    )
  }

  return { app, close, sessions, [Symbol.asyncDispose]: close }
}
