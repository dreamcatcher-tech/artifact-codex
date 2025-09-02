#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import '@std/dotenv/load'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createFlyMachine, listFlyMachines } from './fly.ts'

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
  'list_agents',
  {
    title: 'List Agents',
    description: 'Lists Agents',
    inputSchema: {},
  },
  async () => {
    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')

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

server.registerTool(
  'create_agent',
  {
    title: 'Create Agent',
    description: 'Creates a new Fly Machine for this app using AGENT_IMAGE.',
    inputSchema: {
      // Leave basic type validation here; enforce name pattern in handler for richer UX
      name: z.string(),
    },
  },
  async ({ name }) => {
    // Additional runtime validation for friendly error in result payloads
    const valid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
    if (!valid) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Invalid agent name. Allowed: lowercase letters, digits, hyphens only; 1–63 chars; must start/end with a letter or digit. Not allowed: slashes (/), spaces, underscores (_), dots (.), or other punctuation.',
          },
        ],
      }
    }

    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')
    const image = getEnv('FLY_IMAGE_REF')
    const region = getEnv('FLY_REGION')

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
    if (!image) {
      return {
        content: [
          {
            type: 'text',
            text: 'Missing agent image. Set FLY_IMAGE_REF in env.',
          },
        ],
      }
    }

    try {
      const created = await createFlyMachine({
        appName,
        token: flyToken,
        name,
        image,
        region,
      })
      return {
        content: [
          { type: 'text', text: JSON.stringify(created, null, 2) },
        ],
      }
    } catch (err) {
      return { content: [{ type: 'text', text: (err as Error).message }] }
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
