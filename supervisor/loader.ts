import type { Context } from '@hono/hono'
import Debug from 'debug'
import {
  type AgentClient,
  COMPUTER_AGENTS,
  NFS_MOUNT_DIR,
  startAgentClient,
  toStructured,
} from '@artifact/shared'
import { join } from '@std/path'
import { createMcpHandler } from './mcp-handler.ts'
import { z } from 'zod'

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
  let loading = false
  let agentClient: AgentClient | undefined

  const loadingMcpServer = createMcpHandler((server) => {
    server.registerTool('load', {
      title: 'Load',
      description: 'Load the agent',
      inputSchema: { computerId: z.string(), agentId: z.string() },
      outputSchema: { ok: z.boolean() },
    }, async ({ computerId, agentId }) => {
      log('load', computerId, agentId)
      if (loading) {
        throw new Error('Already loading')
      }
      if (agentClient) {
        throw new Error('Already loaded')
      }
      loading = true
      try {
        const opts = await agentResolver(computerId, agentId)
        agentClient = await startAgentClient(opts)
        loading = false
        cb()
        return toStructured({ ok: true })
      } catch (error) {
        loading = false
        agentClient = undefined
        throw error
      }
    })
  })

  const close = async () => {
    await loadingMcpServer.close()
    if (agentClient) {
      await agentClient.close()
    }
    agentClient = undefined
  }

  return {
    get client() {
      if (!agentClient) {
        throw new Error('Agent mcp client not loaded')
      }
      return agentClient
    },
    get handler() {
      if (agentClient || loading) {
        throw new Error('Agent mcp client or loading already in progress')
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

  const cwd = join(import.meta.dirname!, '..', 'agent-test')
  const file = join(cwd, 'main.ts')
  const computer = computerId.toLowerCase()
  const agent = agentId.toLowerCase()
  const agentDir = join(NFS_MOUNT_DIR, computer, COMPUTER_AGENTS, agent)
  return Promise.resolve({
    command: 'deno',
    args: ['run', '-A', file],
    env: { DC_AGENTS_DIR: agentDir },
    cwd,
  })
}
