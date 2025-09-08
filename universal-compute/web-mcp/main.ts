#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

function createMcpServer() {
  const server = new McpServer({ name: 'web-mcp', version: '0.0.1' })

  server.registerTool(
    'echo',
    {
      description: 'Echo back provided text.',
      inputSchema: { text: z.string() },
      outputSchema: { echoed: z.string() },
    },
    ({ text }): CallToolResult => ({
      content: [{ type: 'text', text }],
      structuredContent: { echoed: text },
    }),
  )

  server.registerTool(
    'time',
    {
      description: 'Return current server time.',
      inputSchema: {},
      outputSchema: { iso: z.string(), epochMs: z.number() },
    },
    (): CallToolResult => {
      const now = new Date()
      return {
        content: [{ type: 'text', text: now.toISOString() }],
        structuredContent: { iso: now.toISOString(), epochMs: now.getTime() },
      }
    },
  )

  server.registerTool(
    'ping',
    {
      description: 'Simple liveness check.',
      inputSchema: {},
      outputSchema: { pong: z.boolean() },
    },
    (): CallToolResult => ({
      content: [{ type: 'text', text: 'pong' }],
      structuredContent: { pong: true },
    }),
  )

  return server
}

export function createApp() {
  const app = new Hono()

  const servers = new Set<McpServer>()

  // Stateless handler: create fresh server+transport for every request.
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
