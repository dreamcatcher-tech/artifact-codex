import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAgent } from './mcp.ts'
import deno from './deno.json' with { type: 'json' }

async function bootstrap() {
  const server = new McpServer({ name: deno.name, version: deno.version })
  registerAgent(server)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (import.meta.main) {
  try {
    await bootstrap()
  } catch (error) {
    console.error('failed to start agent-test MCP server:', error)
    Deno.exit(1)
  }
}
