import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'

const capabilities: ServerCapabilities = {
  resources: { subscribe: false, listChanged: false },
  tools: { listChanged: false },
}

export type SimpleServerOptions = {
  name?: string
  version?: string
  title?: string
}

export const createMcpServer = async (
  opts: SimpleServerOptions = {},
): Promise<McpServer> => {
  const server = new McpServer({
    title: opts.title ?? 'Example MCP Server',
    name: opts.name ?? 'example-mcp-server',
    version: opts.version ?? '0.0.0',
  }, { capabilities })

  // A very small demonstration tool; we can extend later.
  server.registerTool(
    'echo',
    {
      description: 'Echo back a message',
      inputSchema: {
        message: z.string().describe('Message to echo back'),
      },
      outputSchema: {
        echoed: z.string(),
      },
    },
    async (args: { message: string }): Promise<CallToolResult> => {
      const structuredContent = { echoed: args.message }
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      }
    },
  )

  return server
}
