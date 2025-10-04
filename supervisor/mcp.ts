import type { Context } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { createInteractionsServer } from '@artifact/mcp-interactions'
import type { Agent } from '@artifact/shared'
import { type Debugger } from 'debug'

import { createFaces, type FaceKindConfig } from './faces.ts'
import { createInteractions } from './interactions.ts'

type FaceId = string

export interface McpHandlerOptions {
  serverName: string
  serverVersion: string
  faceKinds: readonly FaceKindConfig[]
  log: Debugger
  onPendingChange: (pendingCount: number) => void
}

export const createMcpHandler = (
  { serverName, serverVersion, faceKinds, log, onPendingChange }:
    McpHandlerOptions,
) => {
  let closed = false
  log = log.extend('mcp')
  const facesStore = new Map<FaceId, Agent>()
  const faces = createFaces(facesStore, { faceKinds, log })
  const interactions = createInteractions(facesStore, log, onPendingChange)

  const servers = new Set<McpServer>()
  const handler = async (c: Context) => {
    if (closed) {
      throw new Error('MCP handler closed')
    }
    log('MCP handler start %s %s', c.req.method, c.req.path)
    const server = new McpServer({ name: serverName, version: serverVersion })
    createFacesServer(server, faces)
    createInteractionsServer(server, interactions)
    servers.add(server)
    const transport = new StreamableHTTPTransport()
    transport.onclose = () => {
      log('MCP transport closed')
      servers.delete(server)
    }
    await server.connect(transport)
    log('MCP server connected (total: %d)', servers.size)

    return transport.handleRequest(c)
  }

  const close = async () => {
    if (closed) {
      throw new Error('MCP handler already closed')
    }
    closed = true

    log(
      'MCP handler closing: servers=%d faces=%d',
      servers.size,
      facesStore.size,
    )
    for (const server of servers) {
      server.close()
    }
    servers.clear()
    const promises = facesStore.values().map((face) => face.destroy())
    facesStore.clear()
    await Promise.all(promises)
    log('MCP handler closed')
  }

  return { handler, close }
}
