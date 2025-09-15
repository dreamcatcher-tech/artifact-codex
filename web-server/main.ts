#!/usr/bin/env -S deno run -A
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { Hono } from '@hono/hono'
import { cors } from '@hono/hono/cors'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import { baseUrl, createFetch } from './fixture.ts'
import Debug from 'debug'
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
  app.use('*', async (c, next) => {
    log('host:', c.req.header('host'))

    // do the proxy
    const port = c.req.header('fly-forwarded-port')
    if (port && port !== '443') {
      const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      if (isWS) {
        const res = proxyWS(c.req.raw)
        emit(c.req.raw, res)
        return res
      }
      const res = await proxyHTTP(c.req.raw)
      emit(c.req.raw, res)
      return res
    }

    // be the MCP server
    if (c.req.query('mcp') !== undefined) {
      const res = await mcp.handler(c)
      emit(c.req.raw, res)
      return res
    }

    // create the default face or await its construction.

    // otherwise, proxy thru to the default face

    await next()
    const res = c.res as Response
    emit(c.req.raw, res)
    return res
  })

  const createDefaultFace = async () => {
    const client = new Client({
      name: 'default-face',
      version: '0.0.1',
    })
    const fetch = createFetch(app)
    const opts = { fetch }
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), opts)
    await client.connect(transport)
    const { structuredContent } = await client.callTool({
      name: 'create_face',
      arguments: { agentId: '@self', faceKindId: 'codex' },
    }) as { structuredContent?: { faceId?: string } }
    const faceId = structuredContent?.faceId
    if (!faceId) {
      throw new Error('No faceId returned')
    }
    console.log('defaultFace', faceId)
    const face = await client.callTool({
      name: 'read_face',
      arguments: { agentId: '@self', faceId },
    })
    console.log('defaultFace', face)
    return face
  }
  const defaultFace = createDefaultFace()

  // kind with no face, will trigger a new face, if that is permitted

  const close = () => {
    log('createApp: close')
    mcp.close()
  }

  return { app, close }
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
