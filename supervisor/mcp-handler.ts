import type { Context } from '@hono/hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import Debug from 'debug'
import deno from './deno.json' with { type: 'json' }
const { name, version } = deno

const log = Debug('@artifact/supervisor:mcp')

export const createMcpHandler = (register: (server: McpServer) => void) => {
  const servers = new Set<McpServer>()

  const handler = async (c: Context) => {
    log('MCP handler start %s %s', c.req.method, c.req.path)
    const server = new McpServer({ name, version })
    servers.add(server)

    register(server)

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
    log('MCP handler closing: servers=%d', servers.size)
    for (const server of servers) {
      await server.close()
    }
    servers.clear()
    log('MCP handler closed')
  }

  return { handler, close }
}

export type McpHandler = ReturnType<typeof createMcpHandler>
