import type { Context } from '@hono/hono'
import Debug from 'debug'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { toStructured, waitForPidExit } from '@artifact/shared'
import { createMcpHandler } from './mcp-handler.ts'
import { z } from 'zod'
import deno from './deno.json' with { type: 'json' }
const { name, version } = deno

const log = Debug('@artifact/supervisor:loader')

export type AgentResolver = (computerId: string, agentId: string) => Promise<{
  command: string
  args: string[]
  env: Record<string, string>
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

      try {
        transport = new StdioClientTransport({ command, args, env, cwd })

        const client = new Client({ name, version })
        await client.connect(transport)
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
  // load up the agent from the filesystem
  // resolve what the command to run the agent is
  throw new Error('Not implemented: ' + computerId + ' ' + agentId)
}
