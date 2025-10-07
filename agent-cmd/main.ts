import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAgent } from './mcp.ts'
import deno from './deno.json' with { type: 'json' }

if (import.meta.main) {
  try {
    const server = new McpServer({ name: deno.name, version: deno.version })
    registerAgent(server)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } catch (error) {
    console.error('failed to start agent-cmd MCP server:', error)
    Deno.exit(1)
  }
}
