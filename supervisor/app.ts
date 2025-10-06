import { Hono, type HonoRequest } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { cors } from '@hono/hono/cors'
import type { Debugger } from 'debug'
import { createMcpHandler } from './mcp-handler.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import { isWebSocketRequest, portFromHeaders } from './utils.ts'
import type { IdleTrigger } from '@artifact/shared'
import { MCP_PORT } from '@artifact/shared'
import { createProvisioner } from './provision.ts'

const IN_MEMORY_BASE_URL = new URL('http://in-memory/?mcp')

export interface SupervisorOptions {
  serverName: string
  log: Debugger
  idler: IdleTrigger
}

export interface SupervisorServer {
  app: Hono
  close(): Promise<void>
}

export const createSupervisor = (
  { serverName, log, idler }: SupervisorOptions,
): SupervisorServer => {
  log = log.extend('supervisor')
  log('init name=%s', serverName)

  // switch mcp modes here, since the proxy should be disabled until we are provisioned

  const app = new Hono()
  app.use('*', logger())
  app.use('*', idler.middleware)
  app.use(corsMiddleware)

  // TODO check the auth belongs to the computer we serve

  const provisioner = createProvisioner()
  const provisionerMcpHandler = createMcpHandler(provisioner.registerTools)

  app.use('*', async (c, next) => {
    if (await provisioner.isProvisioned()) {
      return next()
    }
    if (!isMcpRequest(c.req)) {
      return c.text('Awaiting provisioning mcp request', 503)
    }
    return await provisioner.handler(c)
  })

  app.use('*', async (c, next) => {
    if (isMcpRequest(c.req)) {
      return next()
    }

    const forwardedPort = portFromHeaders(c.req)
    if (forwardedPort && forwardedPort !== 443) {
      return await proxyRequest(c.req, forwardedPort, log, idler)
    }

    // TODO buffer until the face is ready
    // read the view from the mcp server resources
    // if not present, return a regular thing
    return c.text('todo: read the view from the mcp server resources')
    // return await proxyRequest(c.req, AGENT_LOCAL_PORT, log, idler)
  })

  // now decide if we have been provisioned or not
  const mcp = createMcpHandler({ serverName, log, idler })

  app.use('*', async (c) => {
    if (await provisioner.isProvisioned()) {
    }

    return await mcp.handler(c)
  })

  const close = async () => {
    log('supervisor: close')
    await provisioner.isProvisioned()
    await provisionerMcpHandler.close()
    await mcp.close()
  }

  return { app, close }
}

const isMcpRequest = (req: HonoRequest) => {
  const port = portFromHeaders(req)
  return port === MCP_PORT
}
const proxyRequest = async (
  req: HonoRequest,
  port: number,
  log: Debugger,
  idler: IdleTrigger,
) => {
  const onActivity = (kind: string, detail: string) => {
    // idler.touch(`proxy ${kind}: ${detail}`)
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

const corsMiddleware = cors({
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
})
