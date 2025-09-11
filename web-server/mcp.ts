import type { Context } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { createInteractionsServer } from '@artifact/mcp-interactions'
import { createFacesServer } from '@artifact/mcp-faces'
import { createInteractions } from './interactions.ts'
import { createFaces } from './faces.ts'
import type { Face } from '@artifact/shared'
type FaceId = string

export const mcpHandler = () => {
  const facesStore = new Map<FaceId, Face>()
  const faces = createFaces(facesStore)
  const interactions = createInteractions(facesStore)

  const servers = new Set<McpServer>()
  const handler = async (c: Context) => {
    const server = new McpServer({ name: 'web-server', version: '0.0.1' })
    createFacesServer(server, faces)
    createInteractionsServer(server, interactions)
    servers.add(server)
    const transport = new StreamableHTTPTransport()
    transport.onclose = () => {
      servers.delete(server)
    }
    await server.connect(transport)

    return transport.handleRequest(c)
  }

  const close = () => {
    for (const server of servers) {
      server.close()
    }
    servers.clear()
    for (const face of facesStore.values()) {
      face.destroy()
    }
    facesStore.clear()
  }

  return { handler, close }
}
