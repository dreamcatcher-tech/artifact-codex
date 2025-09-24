import type { Context } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { createInteractionsServer } from '@artifact/mcp-interactions'
import { createFacesServer } from '@artifact/mcp-faces'
import { createInteractions } from './interactions.ts'
import { createFaces } from './faces.ts'
import type { Face } from '@artifact/shared'
import Debug from 'debug'
type FaceId = string

export const mcpHandler = () => {
  let closed = false
  const log = Debug('@artifact/web-server:mcp')
  const facesStore = new Map<FaceId, Face>()
  const faces = createFaces(facesStore)
  const interactions = createInteractions(facesStore)

  const servers = new Set<McpServer>()
  const handler = async (c: Context) => {
    if (closed) {
      throw new Error('MCP handler closed')
    }
    log('MCP handler start %s %s', c.req.method, c.req.path)
    const server = new McpServer({ name: 'web-server', version: '0.0.1' })
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
