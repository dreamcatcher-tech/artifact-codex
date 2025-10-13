import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

export const agentViewSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal('http'),
  url: z.string().url(),
})

export type AgentView = z.infer<typeof agentViewSchema>

export type AgentOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to the Face home directory used for app config/cache/scratch. */
  home?: string
  /** Arbitrary configuration map for agent-kind specific options */
  config?: Record<string, unknown>
}

export async function startAgent(
  name: string,
  version: string,
  register: (server: McpServer) => void,
) {
  try {
    const server = new McpServer({ name, version })
    register(server)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } catch (error) {
    console.error('failed to start agent-cmd MCP server:', error)
    Deno.exit(1)
  }
}
