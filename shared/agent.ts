import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { envs } from './env.ts'

export const agentViewSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal('http'),
  url: z.string().url(),
})

export type AgentView = z.infer<typeof agentViewSchema>

export async function startAgent(
  name: string,
  version: string,
  register: (server: McpServer, agentDir: string) => Promise<void> | void,
) {
  try {
    const server = new McpServer({ name, version })
    const agentDir = envs.DC_AGENTS_DIR()
    await assertDirectory(agentDir)
    register(server, agentDir)
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } catch (error) {
    console.error('failed to start agent MCP server:', error)
    Deno.exit(1)
  }
}

async function assertDirectory(path: string) {
  const stat = await Deno.stat(path)
  if (!stat.isDirectory) {
    throw new Error(`Missing or invalid directory: ${path}`)
  }
}
