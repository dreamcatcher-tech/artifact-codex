#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { load } from '@std/dotenv'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Schemas describing structuredContent for tool results
const machineSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  state: z.string().optional(),
  region: z.string().optional(),
  image: z.string().optional(),
  ip: z.string().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})
const listAgentsOutput = z.object({ machines: z.array(machineSummarySchema) })
const createAgentOutput = z.object({ machine: machineSummarySchema })
const createComputerOutput = z.object({
  newComputer: z.object({ id: z.string(), name: z.string().optional() }),
  firstAgent: machineSummarySchema,
})

const listComputersOutput = z.object({
  computers: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    createdAt: z.string().optional(),
    organizationSlug: z.string().optional(),
  })),
})

const computerExistsOutput = z.object({
  name: z.string(),
  exists: z.boolean(),
})

import {
  appExists,
  createFlyApp,
  createMachine,
  getFlyApp,
  getFlyMachine,
  listFlyApps,
  listMachines,
} from './fly.ts'

await load({
  envPath: new URL('./.env', import.meta.url).pathname,
  export: true,
})

const server = new McpServer({ name: 'fly-mcp', version: '0.0.1' })

// Structured tool results helpers
function toStructured(
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(structuredContent, null, 2),
    }],
    structuredContent,
  }
}
function toError(err: unknown): CallToolResult {
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: msg }], isError: true }
}

// Helper to lazily read env without crashing if --allow-env is omitted.
function getEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

// Shared naming validation for both agent names and computer names
function isValidFlyName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
}

function buildComputerNameFromUserId(userId: string): string {
  // No mutation/normalization beyond concatenation; enforce same validation used for agents
  return `computer-user-${userId}`
}

server.registerTool(
  'list_agents',
  {
    title: 'List Agents',
    description: 'Lists Agents',
    inputSchema: {},
    outputSchema: listAgentsOutput.shape,
  },
  async (): Promise<CallToolResult> => {
    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')

    if (!appName) return toError('Missing app name. Set FLY_APP_NAME in env.')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    try {
      // Single request includes metadata (from config)
      const machines = await listMachines({
        appName,
        token: flyToken,
      })
      return toStructured({ machines })
    } catch (err) {
      return toError(err)
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
    outputSchema: createAgentOutput.shape,
  },
  async ({ name }): Promise<CallToolResult> => {
    // Additional runtime validation for friendly error in result payloads
    const valid = isValidFlyName(name)
    if (!valid) {
      return toError(
        'Invalid agent name. Allowed: lowercase letters, digits, hyphens only; 1–63 chars; must start/end with a letter or digit. Not allowed: slashes (/), spaces, underscores (_), dots (.), or other punctuation.',
      )
    }

    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')
    const image = getEnv('FLY_IMAGE_REF')
    const region = getEnv('FLY_REGION')

    if (!appName) return toError('Missing app name. Set FLY_APP_NAME in env.')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    if (!image) return toError('Missing agent image. Set FLY_IMAGE_REF in env.')

    try {
      // Ensure agents are launched in the 'worker' process group
      const created = await createMachine({
        appName,
        token: flyToken,
        name,
        config: { image, metadata: { 'fly_process_group': 'worker' } },
        region,
      })
      return toStructured({ machine: created })
    } catch (err) {
      return toError(err)
    }
  },
)

server.registerTool(
  'create_computer',
  {
    title: 'Create Computer',
    description:
      "Creates a new Computer (Fly app) named 'computer-user-<userId>' after validation. Copies config from current app. First Agent uses FLY_IMAGE_REF.",
    inputSchema: { userId: z.string() },
    outputSchema: createComputerOutput.shape,
  },
  async ({ userId }): Promise<CallToolResult> => {
    // Perform name validation first for a friendlier UX
    const desiredName = buildComputerNameFromUserId(userId)
    if (!isValidFlyName(desiredName)) {
      return toError(
        "Invalid computer name. userId must produce a valid name after prefixing 'computer-user-'. Allowed: lowercase letters, digits, hyphens only; 1–63 chars total; must start/end with a letter or digit.",
      )
    }

    const currentApp = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')
    const image = getEnv('FLY_IMAGE_REF')
    const region = getEnv('FLY_REGION')

    if (!currentApp) {
      return toError('Missing app name. Set FLY_APP_NAME in env.')
    }
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    if (!image) return toError('Missing agent image. Set FLY_IMAGE_REF in env.')

    try {
      const srcApp = await getFlyApp({ appName: currentApp, token: flyToken })
      const orgSlug = srcApp.organizationSlug
      if (!orgSlug) {
        return toError(
          'Unable to determine organization for current app. Ensure the app exists and token has access.',
        )
      }

      const newAppName = desiredName
      const createdApp = await createFlyApp({
        token: flyToken,
        appName: newAppName,
        orgSlug,
      })

      // Try to copy config from an existing machine in the current app
      const machines = await listMachines({
        appName: currentApp,
        token: flyToken,
      })

      let machineConfig: Record<string, unknown> = { image }
      let machineRegion: string | undefined = region
      if (machines.length > 0) {
        const base = await getFlyMachine({
          appName: currentApp,
          token: flyToken,
          machineId: machines[0].id,
        })
        const cfg = base.config && JSON.parse(JSON.stringify(base.config))
        if (cfg && typeof cfg === 'object') {
          // override image with the requested agent image
          ;(cfg as Record<string, unknown>).image = image
          machineConfig = cfg as Record<string, unknown>
        }
        if (!machineRegion) machineRegion = base.region
      }

      const createdMachine = await createMachine({
        appName: createdApp.name ?? newAppName,
        token: flyToken,
        name: 'agent-1',
        config: machineConfig,
        region: machineRegion,
      })

      return toStructured({
        newComputer: { id: createdApp.id, name: createdApp.name },
        firstAgent: createdMachine,
      })
    } catch (err) {
      return toError(err)
    }
  },
)

server.registerTool(
  'list_computers',
  {
    title: 'List Computers',
    description: 'Lists Computers (Fly apps) accessible to the token.',
    inputSchema: { orgSlug: z.string().optional() },
    outputSchema: listComputersOutput.shape,
  },
  async ({ orgSlug }): Promise<CallToolResult> => {
    const flyToken = getEnv('FLY_API_TOKEN')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    try {
      const apps = await listFlyApps({ token: flyToken, orgSlug })
      return toStructured({
        computers: apps.map((a) => ({
          id: a.id,
          name: a.name,
          createdAt: a.createdAt,
          organizationSlug: a.organizationSlug,
        })),
      })
    } catch (err) {
      return toError(err)
    }
  },
)

server.registerTool(
  'computer_exists',
  {
    title: 'Computer Exists',
    description:
      "Checks if a Computer (Fly app) for a given userId exists. Name is 'computer-user-<userId>'.",
    inputSchema: { userId: z.string() },
    outputSchema: computerExistsOutput.shape,
  },
  async ({ userId }): Promise<CallToolResult> => {
    const flyToken = getEnv('FLY_API_TOKEN')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    try {
      const name = buildComputerNameFromUserId(userId)
      if (!isValidFlyName(name)) {
        return toStructured({ name, exists: false })
      }
      const exists = await appExists({ token: flyToken, appName: name })
      return toStructured({ name, exists })
    } catch (err) {
      return toError(err)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
