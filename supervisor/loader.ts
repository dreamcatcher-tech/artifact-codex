import type { Context } from '@hono/hono'
import Debug from 'debug'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  AGENT_HOME,
  AGENT_WORKSPACE,
  COMPUTER_AGENTS,
  INTERACTION_TOOL_NAMES,
  NFS_MOUNT_DIR,
  toStructured,
  waitForPidExit,
} from '@artifact/shared'
import { join } from '@std/path'
import { createMcpHandler } from './mcp-handler.ts'
import { z } from 'zod'
import deno from './deno.json' with { type: 'json' }
const { name, version } = deno

const log = Debug('@artifact/supervisor:loader')

export type AgentResolver = (computerId: string, agentId: string) => Promise<{
  command: string
  args: string[]
  env: Record<string, string | number | boolean>
  cwd: string
}>

export const createLoader = (
  cb: () => void,
  agentResolver = fsAgentResolver,
) => {
  let loadingPromise: Promise<void> | undefined
  let agentMcpClient: Client | undefined
  let transport: StdioClientTransport | undefined

  const loadingMcpServer = createMcpHandler((server) => {
    server.registerTool('load', {
      title: 'Load',
      description: 'Load the agent',
      inputSchema: { computerId: z.string(), agentId: z.string() },
      outputSchema: { ok: z.boolean() },
    }, async ({ computerId, agentId }) => {
      log('load', computerId, agentId)
      if (loadingPromise) {
        throw new Error('Already loading')
      }
      if (agentMcpClient) {
        throw new Error('Already loaded')
      }

      const { command, args, env, cwd } = await agentResolver(
        computerId,
        agentId,
      )
      testEnv(env)

      try {
        transport = new StdioClientTransport({
          command,
          args,
          env: env as Record<string, string>,
          cwd,
        })

        const client = new Client({ name, version })
        await client.connect(transport)
        await checkClient(client)
        agentMcpClient = client
        log('agent mcp client connected')
      } finally {
        loadingPromise = undefined
      }
      cb()
      return toStructured({ ok: true })
    })
  })
  const close = async () => {
    await loadingMcpServer.close()
    const pid = transport?.pid
    if (agentMcpClient) {
      await agentMcpClient.close()
    }
    agentMcpClient = undefined
    await waitForPidExit(pid)
  }
  return {
    get client() {
      if (!agentMcpClient) {
        throw new Error('Agent mcp client not loaded')
      }
      return agentMcpClient
    },
    get handler() {
      if (agentMcpClient) {
        throw new Error('Agent mcp client already loaded')
      }
      return async (c: Context) => {
        if (c.req.path === '/ping') {
          return c.text('pong')
        }
        return await loadingMcpServer.handler(c)
      }
    },
    close,
    [Symbol.asyncDispose]: close,
  }
}

const fsAgentResolver: AgentResolver = (computerId, agentId) => {
  log('fsAgentResolver defaulting to test', computerId, agentId)

  // if each agent supplied its own env setter, then we can pass that in to the command
  // makes it easy to mock, but also guarantees we have everything we want

  // provide computer object so we can query the computer using an api

  const cwd = join(import.meta.dirname!, '..', 'agent-test')
  const file = join(cwd, 'main.ts')
  const computer = computerId.toLowerCase()
  const agent = agentId.toLowerCase()
  const agentDir = join(NFS_MOUNT_DIR, computer, COMPUTER_AGENTS, agent)
  const workspaceDir = join(agentDir, AGENT_WORKSPACE)
  const homeDir = join(agentDir, AGENT_HOME)
  return Promise.resolve({
    command: 'deno',
    args: ['run', '-A', file],
    env: {
      CODEX_AGENT_WORKSPACE: workspaceDir,
      CODEX_AGENT_HOME: homeDir,
    },
    cwd,
  })
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

function testEnv(env: Record<string, string | number | boolean>) {
  if (!env.DC_AGENTS_DIR) {
    throw new Error('DC_AGENTS_DIR is required')
  }
}
