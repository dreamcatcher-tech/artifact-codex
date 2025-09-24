#!/usr/bin/env -S deno run -A
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
const log = Debug('@artifact/fly-agent')

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

  const parseToolError = (
    result: { isError?: boolean; content?: { type: string; text?: string }[] },
  ): string | undefined => {
    if (!result.isError) return undefined
    const texts =
      result.content?.flatMap((block) =>
        block.type === 'text' && block.text ? [block.text.trim()] : []
      ) ?? []
    return texts.filter((text) => text.length > 0).join('\n') || undefined
  }

  try {
    await client.connect(transport)

    const workspace = Deno.cwd()

    const createResult = await client.callTool({
      name: 'create_face',
      arguments: {
        agentId: '@self',
        faceKindId: 'codex',
        workspace,
        hostname: HOST,
      },
    }) as {
      structuredContent?: { faceId?: string }
      isError?: boolean
      content?: { type: string; text?: string }[]
    }

    const createError = parseToolError(createResult)
    if (createError) {
      throw new Error(`Failed to create default face: ${createError}`)
    }

    const faceId = createResult.structuredContent?.faceId
    if (!faceId) {
      throw new Error('No faceId returned')
    }

    const readResult = await client.callTool({
      name: 'read_face',
      arguments: { agentId: '@self', faceId },
    }) as {
      structuredContent?: unknown
      isError?: boolean
      content?: { type: string; text?: string }[]
    }

    const readError = parseToolError(readResult)
    if (readError) {
      throw new Error(`Failed to read default face ${faceId}: ${readError}`)
    }

    const structured = readResult.structuredContent
    if (!structured) {
      throw new Error(`Face ${faceId} did not return structured content`)
    }

    const { views } = readFaceOutput.parse(structured)
    if (!views[0]) {
      throw new Error(`Face ${faceId} did not expose any views`)
    }
    return views[0].port
  } finally {
    try {
      await client.close()
    } catch {
      // ignore
    }
  }
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
