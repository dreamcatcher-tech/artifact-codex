import { readFaceOutput } from '@artifact/mcp-faces'
import { HOST, setFlyMachineHeader } from '@artifact/shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Hono, type HonoRequest } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { cors } from '@hono/hono/cors'
import Debug from 'debug'
import type { Debugger } from 'debug'

import { createMcpHandler } from './mcp.ts'
import type { FaceKindConfig } from './faces.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import { isMcpRequest, isWebSocketRequest, portFromHeaders } from './utils.ts'

const IN_MEMORY_BASE_URL = new URL('http://in-memory/?mcp')

export interface CreateAgentWebServerOptions {
  serverName: string
  serverVersion?: string
  faceKinds: readonly FaceKindConfig[]
  defaultFaceKindId?: FaceKindConfig['id']
  defaultFaceAgentId?: string
  debugNamespace?: string
}

export interface CreateAgentWebServerResult {
  app: Hono
  close(): Promise<void>
}

export interface DefaultFaceOptions {
  faceKindId: FaceKindConfig['id']
  agentId: string
}

export const createAgentWebServer = (
  options: CreateAgentWebServerOptions,
): CreateAgentWebServerResult => {
  const {
    serverName,
    serverVersion = '0.0.1',
    faceKinds,
    defaultFaceKindId,
    defaultFaceAgentId = '@self',
  } = options
  const debugNamespace = options.debugNamespace ?? '@artifact/web-server'
  const log = Debug(debugNamespace)

  log(
    'createAgentWebServer: init name=%s faces=%d',
    serverName,
    faceKinds.length,
  )

  const app = new Hono()
  const mcp = createMcpHandler({
    serverName,
    serverVersion,
    faceKinds,
    debugNamespace: `${debugNamespace}:mcp`,
  })

  const emit = (req: Request, res?: Response) => {
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

  app.use('*', logger())

  app.use('*', async (c, next) => {
    try {
      await next()
    } finally {
      const res = c.res
      if (res) setFlyMachineHeader(res.headers)
    }
  })

  let defaultFacePort: number | undefined
  const getDefaultFacePort = defaultFaceKindId
    ? createDefaultFacePortGetter(app, {
      faceKindId: defaultFaceKindId,
      agentId: defaultFaceAgentId,
      debugNamespace: `${debugNamespace}:default-face`,
    })
    : () => Promise.resolve<number | undefined>(undefined)

  app.use('*', async (c, next) => {
    if (isMcpRequest(c.req)) {
      return next()
    }

    const forwardedPort = portFromHeaders(c.req)
    if (forwardedPort && forwardedPort !== 443) {
      return await proxyRequest(c.req, forwardedPort, emit)
    }

    if (!defaultFaceKindId) {
      log('default face not configured; rejecting request')
      const res = new Response('default face not configured', { status: 502 })
      emit(c.req.raw, res)
      return res
    }

    if (!defaultFacePort) {
      defaultFacePort = await getDefaultFacePort()
    }

    if (!defaultFacePort) {
      log('default face available but port missing')
      const res = new Response('default face unavailable', { status: 502 })
      emit(c.req.raw, res)
      return res
    }

    return await proxyRequest(c.req, defaultFacePort, emit)
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
    emit(c.req.raw, res)
    return res
  })

  const close = async () => {
    log('createAgentWebServer: close')
    await mcp.close()
  }

  return { app, close }
}

const proxyRequest = async (
  req: HonoRequest,
  port: number,
  emit: (req: Request, res?: Response) => void,
) => {
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

const createDefaultFacePortGetter = (
  app: Hono,
  options: DefaultFaceOptions & { debugNamespace: string },
) => {
  const { faceKindId, agentId, debugNamespace } = options
  const log = Debug(debugNamespace)
  let cached: number | undefined

  return async () => {
    if (cached) return cached
    cached = await createDefaultFacePort(app, { faceKindId, agentId, log })
    return cached
  }
}

const createDefaultFacePort = async (
  app: Hono,
  { faceKindId, agentId, log }: DefaultFaceOptions & { log: Debugger },
) => {
  log('createDefaultFacePort: start kind=%s agent=%s', faceKindId, agentId)
  const client = new Client({
    name: 'default-face',
    version: '0.0.1',
  })
  const opts = { fetch: createInMemoryFetch(app) }
  const transport = new StreamableHTTPClientTransport(IN_MEMORY_BASE_URL, opts)

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
        agentId,
        faceKindId,
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
      arguments: { agentId, faceId },
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
    log('createDefaultFacePort: ready port=%d', views[0].port)
    return views[0].port
  } finally {
    try {
      await client.close()
    } catch {
      // ignore
    }
  }
}

export const createInMemoryFetch = (app: Hono): FetchLike => {
  const fetch: FetchLike = (url, init) => {
    const request = new Request(url, init as RequestInit)
    return Promise.resolve(app.fetch(request))
  }
  return fetch
}

export const inMemoryBaseUrl = IN_MEMORY_BASE_URL
