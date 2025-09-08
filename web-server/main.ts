#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { createInteractionsServer } from '@artifact/mcp-interactions'
import { createFacesServer } from '@artifact/mcp-faces'
import { createInteractions } from './interactions.ts'
import { createFaces } from './faces.ts'

function createMcpServer() {
  const server = new McpServer({ name: 'web-server', version: '0.0.1' })
  // Register tools from package servers onto this instance
  const faces = createFaces()
  createFacesServer(server, faces)

  const interactions = createInteractions()
  createInteractionsServer(server, interactions)
  return server
}

export function createApp() {
  const app = new Hono()

  const servers = new Set<McpServer>()

  app.all('/mcp', async (c) => {
    const server = createMcpServer()
    servers.add(server)
    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    return transport.handleRequest(c)
  })

  const close = () => {
    for (const server of servers) {
      server.close()
    }
    servers.clear()
  }

  return { app, close }
}

if (import.meta.main) {
  const port = Number(Deno.env.get('PORT') ?? '8787')
  const { app } = createApp()
  Deno.serve({ hostname: '0.0.0.0', port }, app.fetch)
}
