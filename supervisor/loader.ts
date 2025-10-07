import Debug from 'debug'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { toStructured, waitForPidExit } from '@artifact/shared'
import { createMcpHandler } from './mcp-handler.ts'
import { z } from 'zod'
import { join } from '@std/path'
import deno from './deno.json' with { type: 'json' }
const { name, version } = deno

const log = Debug('@artifact/supervisor:loader')

export const createLoader = (cb: () => void) => {
  let loadingPromise: Promise<void> | undefined
  let agentMcpClient: Client | undefined
  let agentMcpTools: Tool[] | undefined
  let agentMcpTransport: StdioClientTransport | undefined

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
      // has to go load from the disk to learn what agent to load

      const projectRoot = new URL('..', import.meta.url).pathname
      const file = join(projectRoot, 'agent-test/main.ts')
      try {
        const transport = new StdioClientTransport({
          command: 'deno',
          args: ['run', '-A', file],
          env: {},
          cwd: projectRoot,
        })

        const client = new Client({ name, version })

        await client.connect(transport)
        const { tools } = await client.listTools()

        agentMcpTools = tools
        agentMcpClient = client
        agentMcpTransport = transport
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
    const pid = agentMcpTransport?.pid
    if (agentMcpClient) {
      await agentMcpClient.close()
    }
    agentMcpTools = undefined
    agentMcpClient = undefined
    agentMcpTransport = undefined
    await waitForPidExit(pid)
  }
  return {
    get client() {
      if (!agentMcpClient) {
        throw new Error('Agent mcp client not loaded')
      }
      return agentMcpClient
    },
    get tools() {
      if (!agentMcpTools) {
        throw new Error('Agent mcp tools not loaded')
      }
      return agentMcpTools
    },
    get loadingPromise() {
      return loadingPromise
    },
    get handler() {
      return loadingMcpServer.handler
    },
    close,
    [Symbol.asyncDispose]: close,
  }
}
