import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { envs } from './env.ts'
import {
  type AgentParams,
  INTERACTION_TOOL_NAMES,
  waitForPidExit,
} from './mod.ts'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import deno from './deno.json' with { type: 'json' }
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

export const agentViewSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.literal('http'),
  url: z.string().url(),
})

export type AgentView = z.infer<typeof agentViewSchema>

export type Register = (
  server: McpServer,
  options: { agentDir: string },
) => Promise<void> | void

export async function startAgentServer(
  name: string,
  version: string,
  register: Register,
) {
  try {
    const server = new McpServer({ name, version })
    const agentDir = envs.DC_AGENTS_DIR()
    await assertDirectory(agentDir)
    register(server, { agentDir })
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } catch (error) {
    console.error('failed to start agent MCP server:', error)
    Deno.exit(1)
  }
}

export async function startAgentClient(params: AgentParams) {
  const { command, args = [], env = {}, cwd } = params
  testEnv(env)
  const transport = new StdioClientTransport({
    command: 'setsid', // cooperates with client.close to kill the whole tree
    args: [command, ...args],
    env: env as Record<string, string>,
    cwd,
  })
  const client = new Client({ name: 'agent-client', version: deno.version })
  await client.connect(transport)
  await checkClient(client)

  const close = client.close.bind(client)
  client.close = async () => {
    const pid = transport?.pid
    if (pid) {
      const killProcTree = -pid
      Deno.kill(killProcTree, 'SIGTERM') // cooperates with setsid
    }
    await close()
    await waitForPidExit(pid)
  }
  return client
}

export type AgentClient = Awaited<ReturnType<typeof startAgentClient>>

async function assertDirectory(path: string) {
  const stat = await Deno.stat(path)
  if (!stat.isDirectory) {
    throw new Error(`Missing or invalid directory: ${path}`)
  }
}

function testEnv(env: Record<string, string | number | boolean>) {
  if (!env.DC_AGENTS_DIR) {
    throw new Error('DC_AGENTS_DIR is required')
  }
}

const checkClient = async (client: Client) => {
  const { tools } = await client.listTools()
  if (tools.length === 0) {
    throw new Error('No tools found')
  }
  const names = new Set(tools.map((tool) => tool.name))
  const missing = []
  for (const name of INTERACTION_TOOL_NAMES) {
    if (!names.has(name)) {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing interaction tools: ${missing.join(', ')}`)
  }
}
