#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { listFlyMachines } from './fly.ts'

const server = new McpServer({ name: 'fly-mcp', version: '0.0.1' })

// Helper to lazily read env without crashing if --allow-env is omitted.
function getEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

server.registerTool(
  'echo',
  {
    title: 'Echo',
    description: 'Echo back text',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: 'text', text }] }),
)

server.registerTool(
  'add',
  {
    title: 'Add',
    description: 'Add two numbers',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
)

server.registerTool(
  'list_agents',
  {
    title: 'List Agents',
    description: 'Lists Agents',
    inputSchema: {},
  },
  async () => {
    const appName = getEnv('FLY_APP_NAME') || getEnv('FLY_APP')
    const flyToken = getEnv('FLY_API_TOKEN') || getEnv('FLY_ACCESS_TOKEN')

    if (!appName) {
      return {
        content: [
          {
            type: 'text',
            text: 'Missing app name. Set FLY_APP_NAME (or FLY_APP) in env.',
          },
        ],
      }
    }
    if (!flyToken) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Missing Fly API token. Set FLY_API_TOKEN (or FLY_ACCESS_TOKEN).',
          },
        ],
      }
    }
    try {
      const summary = await listFlyMachines({ appName, token: flyToken })
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      }
    } catch (err) {
      return { content: [{ type: 'text', text: (err as Error).message }] }
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
