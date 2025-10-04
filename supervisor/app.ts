import { Hono, type HonoRequest } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { cors } from '@hono/hono/cors'
import type { Debugger } from 'debug'

import { createMcpHandler } from './mcp.ts'
import type { FaceKindConfig } from './faces.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import { isMcpRequest, isWebSocketRequest, portFromHeaders } from './utils.ts'
import { createIdleShutdownManager } from './idle.ts'

const IN_MEMORY_BASE_URL = new URL('http://in-memory/?mcp')

export interface AgentWebServerOptions {
  serverName: string
  serverVersion?: string
  faceKinds: readonly FaceKindConfig[]
  log: Debugger
  timeoutMs: number
  onIdle: () => void | Promise<void>
}

export interface AgentWebServerResult {
  app: Hono
  close(): Promise<void>
}

export const createAgentWebServer = (
  { serverName, serverVersion = '0.0.1', faceKinds, log, timeoutMs, onIdle }:
    AgentWebServerOptions,
): AgentWebServerResult => {
  log = log.extend('supervisor')
  log('init name=%s faces=%d', serverName, faceKinds.length)

  const app = new Hono()
  const idler = createIdleShutdownManager({ timeoutMs, onIdle, log })

  const mcp = createMcpHandler({
    serverName,
    serverVersion,
    faceKinds,
    log,
    onPendingChange: idler.handlePendingChange,
  })

  // TODO check the auth belongs to the computer we serve

  app.use('*', logger())
  app.use('*', idler.middleware)

  app.use('*', async (c, next) => {
    if (isMcpRequest(c.req)) {
      return next()
    }

    const forwardedPort = portFromHeaders(c.req)
    if (forwardedPort && forwardedPort !== 443) {
      return await proxyRequest(c.req, forwardedPort, log, idler)
    }

    // in the new model, there is always a face, but there is always a single face for an agent

    const AGENT_LOCAL_PORT = 10000 // all faces have to use this port we pass in
    // TODO buffer until the face is ready
    return await proxyRequest(c.req, AGENT_LOCAL_PORT, log, idler)
  })

  app.use(cors({
    origin: '*',
    allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'content-type',
      'mcp-session-id',
      'mcp-protocol-version',
    ],
    exposeHeaders: [
      'mcp-session-id',
      'WWW-Authenticate',
    ],
  }))

  app.use('*', async (c) => {
    if (!isMcpRequest(c.req)) {
      throw new Error('MCP request expected')
    }
    const res = await mcp.handler(c)
    return res
  })

  const close = async () => {
    log('createAgentWebServer: close')
    idler.dispose()
    await mcp.close()
  }

  return { app, close }
}

const proxyRequest = async (
  req: HonoRequest,
  port: number,
  log: Debugger,
  idler: { touch: (reason: string) => void },
) => {
  const onActivity = (kind: string, detail: string) => {
    idler.touch(`proxy ${kind}: ${detail}`)
  }

  const isWS = isWebSocketRequest(req)
  if (isWS) {
    const res = proxyWS(req.raw, port, log, onActivity)
    return res
  }
  const res = await proxyHTTP(req.raw, port, log, onActivity)
  return res
}

export const inMemoryBaseUrl = IN_MEMORY_BASE_URL
