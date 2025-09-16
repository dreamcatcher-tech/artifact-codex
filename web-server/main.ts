#!/usr/bin/env -S deno run -A
import { dirname, fromFileUrl } from '@std/path'
import { readFaceOutput } from '@artifact/mcp-faces'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Hono, HonoRequest } from '@hono/hono'
import { cors } from '@hono/hono/cors'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import { baseUrl, createFetch } from './fixture.ts'
import { isMcpRequest, isWebSocketRequest, portFromHeaders } from './utils.ts'
import Debug from 'debug'
import { HOST } from '@artifact/shared'
const log = Debug('@artifact/web-server')

function emit(req: Request, res?: Response) {
  try {
    const method = req.method
    const pathname = new URL(req.url).pathname
    if (res) {
      const text = res.statusText ? ` ${res.statusText}` : ''
      log('%s %s -> %d%s', method, pathname, res.status, text)
    } else {
      log('%s %s', method, pathname)
    }
  } catch {
    // ignore
  }
}

export function createApp() {
  log('createApp: init')
  const app = new Hono()
  const mcp = mcpHandler()

  let defaultFacePort: number | undefined
  const getDefaultFacePort = async () => {
    if (!defaultFacePort) defaultFacePort = await createDefaultFacePort(app)
    return defaultFacePort
  }

  app.use('*', async (c, next) => {
    log('host:', c.req.header('host'))

    if (isMcpRequest(c.req)) {
      return next()
    }

    const forwardedPort = portFromHeaders(c.req)
    if (forwardedPort && forwardedPort !== 443) {
      return await proxy(c.req, forwardedPort)
    }

    const port = await getDefaultFacePort()
    return await proxy(c.req, port)
  })

  app.use(cors({
    // CORS is required for the MCP server to work as an api service
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
    emit(c.req.raw, res)
    return res
  })

  const close = async () => {
    log('createApp: close')
    await mcp.close()
  }

  return { app, close }
}

const proxy = async (req: HonoRequest, port: number) => {
  const isWS = isWebSocketRequest(req)
  if (isWS) {
    const res = proxyWS(req.raw, port)
    emit(req.raw, res)
    return res
  }
  const res = await proxyHTTP(req.raw, port)
  emit(req.raw, res)
  return res
}

const createDefaultFacePort = async (app: Hono) => {
  const client = new Client({
    name: 'default-face',
    version: '0.0.1',
  })
  const opts = { fetch: createFetch(app) }
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), opts)
  await client.connect(transport)

  const workspace = dirname(dirname(fromFileUrl(import.meta.url)))

  const home = await Deno.makeTempDir({ prefix: 'face-codex-' })

  const { structuredContent } = await client.callTool({
    name: 'create_face',
    arguments: {
      agentId: '@self',
      faceKindId: 'codex',
      workspace,
      home,
      hostname: HOST,
    },
  }) as { structuredContent?: { faceId?: string } }

  const faceId = structuredContent?.faceId
  if (!faceId) {
    throw new Error('No faceId returned')
  }

  const face = await client.callTool({
    name: 'read_face',
    arguments: { agentId: '@self', faceId },
  })
  const { views } = readFaceOutput.parse(face.structuredContent)
  return views[0].port
}

if (import.meta.main) {
  Debug.enable('@artifact/*')
  const port = Number(Deno.env.get('PORT') ?? 8080)
  const hostname = '0.0.0.0'
  const { app } = createApp()

  // create the default face, that it may be proxied into

  log('serve: starting on :%d', port)
  Deno.serve({ port, hostname, reusePort: false }, app.fetch)
}
