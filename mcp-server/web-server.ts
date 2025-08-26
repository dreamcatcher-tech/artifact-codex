import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { Hono, type Context, type ErrorHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { cors } from 'hono/cors'
import { poweredBy } from 'hono/powered-by'
import { secureHeaders } from 'hono/secure-headers'
import { ulid } from 'ulid'

import { createMcpServer } from './server.ts'

type McpSession = { server: McpServer; transport: StreamableHTTPTransport }

type TypedContext = {
  Bindings: {
    sessions: Map<string, McpSession>
    apiKeys: Set<string>
  }
}

// Basic API-key auth middleware
const authApiKey = (keys: Set<string>) =>
  createMiddleware<TypedContext>(async (c, next) => {
    // Accept either env-configured or provided set
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

  return c.text(sessionId ? 'Session not found' : 'Bad Request', sessionId ? 404 : 400)
})

const error: ErrorHandler = function (error: Error, c: Context<TypedContext>) {
  return c.json({ error: error.message }, 500)
}

export type ServerGateway = {
  app: Hono<TypedContext>
  close: () => Promise<void>
  sessions: Map<string, McpSession>
  [Symbol.asyncDispose]: () => Promise<void>
}

export const createServer = (opts?: { apiKeys?: readonly string[] }): ServerGateway => {
  const sessions = new Map<string, McpSession>()
  const envKeys = (Deno.env.get('MCP_API_KEYS') || Deno.env.get('MCP_API_KEY') || '')
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
      ],
      exposeHeaders: [
        'mcp-session-id',
      ],
    }))
    .use(poweredBy(), secureHeaders())
    .use(setup(sessions, apiKeys))
    .use(authApiKey(apiKeys))
    .all('/mcp', mcpHandler)
    .onError(error)

  const close = async () => {
    await Promise.all(Array.from(sessions.values()).map(({ server }) => server.close()))
  }

  return { app, close, sessions, [Symbol.asyncDispose]: close }
}

