#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  deriveBaseName,
  type MachineDetail,
  type MachineSummary,
  nextIndexForName,
} from '@artifact/shared'
import { loadEnvFromShared } from '@artifact/shared'
import { getEnv, isValidFlyName, toError, toStructured } from '@artifact/shared'

// Schemas describing structuredContent for tool results (typed from shared)
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
// (Computer management schemas removed in fly-mcp)

import {
  createMachine,
  destroyMachine,
  getFlyMachine,
  listMachines,
} from '@artifact/shared'

await loadEnvFromShared()

const server = new McpServer({ name: 'fly-mcp', version: '0.0.1' })

// Helpers moved to shared/util.ts

// (Computer name helper removed in fly-mcp)

// Detailed machine schema (summary + optional config)
const machineDetailSchema = machineSummarySchema.extend({
  config: z.record(z.unknown()).optional(),
})

const readAgentOutput = z.object({
  exists: z.boolean(),
  agent: machineDetailSchema.optional(),
  reason: z.string().optional(),
})

server.registerTool(
  'read_agent',
  {
    title: 'Read Agent',
    description:
      'Return structured info for an Agent (Machine) by agent id string, where id equals the Machine name. Looks up by name and returns full details, including metadata from config.',
    inputSchema: { id: z.string() },
    outputSchema: readAgentOutput.shape,
  },
  async ({ id }, extra): Promise<CallToolResult> => {
    console.log('read_agent', { id, extra })
    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')

    if (!appName) return toError('Missing app name. Set FLY_APP_NAME in env.')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    try {
      const machines: MachineSummary[] = await listMachines({
        appName,
        token: flyToken,
      })
      const matches = machines.filter((m) => m.name === id)
      if (matches.length === 0) {
        return toStructured({
          exists: false,
          reason: `Agent named '${id}' not found.`,
        })
      }
      if (matches.length > 1) {
        return toError(`Multiple agents named '${id}'. Please disambiguate.`)
      }
      const machineId = matches[0].id
      const detail: MachineDetail = await getFlyMachine({
        appName,
        token: flyToken,
        machineId,
      })
      return toStructured({ exists: true, agent: detail })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Fly API error\s+404/.test(msg)) {
        return toStructured({
          exists: false,
          reason: 'Agent not found via API (404).',
        })
      }
      return toError(err)
    }
  },
)

server.registerTool(
  'list_agents',
  {
    title: 'List Agents',
    description: 'Lists Agents for the current Computer.',
    inputSchema: {},
    outputSchema: listAgentsOutput.shape,
  },
  async (_, extra): Promise<CallToolResult> => {
    console.log('list_agents', { extra })
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
    description:
      'Creates a new Agent for the current Computer using the image of the current Agent',
    inputSchema: {
      // Leave basic type validation here; enforce name pattern in handler for richer UX
      name: z.string(),
    },
    outputSchema: createAgentOutput.shape,
  },
  async ({ name }, extra): Promise<CallToolResult> => {
    console.log('create_agent', { name, extra })
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
      // Determine next indexed name: <base>-<n>
      const base = deriveBaseName(name)
      const existing = await listMachines({ appName, token: flyToken })
      const next = nextIndexForName(existing.map((m) => m.name), base)
      const indexedName = `${base}-${next}`
      if (!isValidFlyName(indexedName)) {
        return toError(
          `Computed agent name '${indexedName}' is invalid or too long; choose a shorter base name.`,
        )
      }

      // Ensure agents are launched in the 'worker' process group
      const created = await createMachine({
        appName,
        token: flyToken,
        name: indexedName,
        config: { image, metadata: { 'fly_process_group': 'worker' } },
        region,
      })
      return toStructured({ machine: created })
    } catch (err) {
      return toError(err)
    }
  },
)

// (Computer tools removed in fly-mcp)

server.registerTool(
  'destroy_agent',
  {
    title: 'Destroy Agent',
    description:
      'Destroys a Machine (Agent) in the current Computer. Provide id or name.',
    inputSchema: {
      id: z.string().optional(),
      name: z.string().optional(),
      force: z.boolean().optional(),
    },
    outputSchema: z.object({
      destroyed: z.boolean(),
      id: z.string(),
      name: z.string().optional(),
    }).shape,
  },
  async ({ id, name, force }): Promise<CallToolResult> => {
    const appName = getEnv('FLY_APP_NAME')
    const flyToken = getEnv('FLY_API_TOKEN')
    if (!appName) return toError('Missing app name. Set FLY_APP_NAME in env.')
    if (!flyToken) {
      return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
    }
    if (!id && !name) return toError('Provide agent id or name.')
    try {
      let targetId = id ?? ''
      let resolvedName = name
      if (!targetId) {
        const list = await listMachines({ appName, token: flyToken })
        const matches = list.filter((m) => m.name === name)
        if (matches.length === 0) {
          return toError(`Agent named '${name}' not found.`)
        }
        if (matches.length > 1) {
          return toError(`Multiple agents named '${name}'. Please use id.`)
        }
        targetId = matches[0].id
        resolvedName = matches[0].name
      }
      await destroyMachine({
        appName,
        token: flyToken,
        machineId: targetId,
        force,
      })
      return toStructured({ destroyed: true, id: targetId, name: resolvedName })
    } catch (err) {
      return toError(err)
    }
  },
)

// (Destroy computer removed in fly-mcp)

const transport = new StdioServerTransport()
await server.connect(transport)
