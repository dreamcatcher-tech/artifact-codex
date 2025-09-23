#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { nextIndexForName } from '@artifact/shared'
import { mapMachineSummary } from '@artifact/shared'
import { getEnv, isValidFlyName, toError, toStructured } from '@artifact/shared'
import { loadEnvFromShared } from '@artifact/shared'
import { readComputerOutputSchema } from '@artifact/shared'
import {
  flyCliAppsCreate,
  flyCliAppsDestroy,
  flyCliAppsInfo,
  flyCliAppsList,
  flyCliCreateMachine,
  flyCliGetMachine,
  flyCliListMachines,
  FlyCommandError,
} from '@artifact/tasks'

// Schemas
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
// Use shared schema for read_computer output to keep shape consistent across projects
const readComputerOutput = readComputerOutputSchema

await loadEnvFromShared()

// Helpers (toStructured, toError, getEnv, isValidFlyName) moved to shared/util.ts
function toFlyErrorResult(err: unknown): CallToolResult {
  if (
    err instanceof Error &&
    err.message.includes('Missing Fly API token')
  ) {
    return toError('Missing Fly API token. Set FLY_API_TOKEN in env.')
  }
  return toError(err)
}
function buildComputerNameFromUserId(userId: string): string {
  return `computer-user-${userId}`
}

async function appExists(appName: string): Promise<boolean> {
  try {
    await flyCliAppsInfo({ appName })
    return true
  } catch (error) {
    if (error instanceof FlyCommandError) {
      return false
    }
    throw error
  }
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'computer-mcp', version: '0.0.1' })

  server.registerTool(
    'create_computer',
    {
      title: 'Create Computer',
      description:
        "Creates a new Computer named 'computer-user-<userId>' after validation. Copies config from the current Computer, with agents using the same image as the current agent.",
      inputSchema: { userId: z.string() },
      outputSchema: createComputerOutput.shape,
    },
    async ({ userId }, extra): Promise<CallToolResult> => {
      console.log('create_computer', { userId, extra })
      const desiredName = buildComputerNameFromUserId(userId)
      if (!isValidFlyName(desiredName)) {
        return toError(
          "Invalid computer name. userId must produce a valid name after prefixing 'computer-user-'. Allowed: lowercase letters, digits, hyphens only; 1–63 chars total; must start/end with a letter or digit.",
        )
      }

      const currentApp = getEnv('FLY_APP_NAME')
      const image = getEnv('FLY_IMAGE_REF')
      const region = getEnv('FLY_REGION')
      const currentMachineId = getEnv('FLY_MACHINE_ID')

      if (!currentApp) {
        return toError('Missing app name. Set FLY_APP_NAME in env.')
      }
      if (!image) {
        return toError('Missing agent image. Set FLY_IMAGE_REF in env.')
      }

      try {
        const srcApp = await flyCliAppsInfo({
          appName: currentApp,
        })
        const orgSlug = srcApp.organizationSlug
        if (!orgSlug) {
          return toError(
            'Unable to determine organization for current app. Ensure the app exists and token has access.',
          )
        }

        const newAppName = desiredName
        const createdApp = await flyCliAppsCreate({
          appName: newAppName,
          orgSlug,
        })

        let machineConfig: Record<string, unknown> = { image }
        let machineRegion: string | undefined = region

        const resolveConfigFromMachine = async (machineId: string) => {
          const base = await flyCliGetMachine({
            appName: currentApp,
            machineId,
          })
          const cfg = base.config && JSON.parse(JSON.stringify(base.config))
          if (cfg && typeof cfg === 'object') {
            ;(cfg as Record<string, unknown>).image = image
            machineConfig = cfg as Record<string, unknown>
          }
          if (!machineRegion) machineRegion = base.region
        }

        if (currentMachineId && currentMachineId.trim()) {
          await resolveConfigFromMachine(currentMachineId.trim())
        } else {
          const machines = await flyCliListMachines({
            appName: currentApp,
          })
          if (machines.length > 0) {
            await resolveConfigFromMachine(machines[0].id)
          }
        }

        const targetAppName = createdApp.name ?? newAppName
        const existingInNewApp = await flyCliListMachines({
          appName: targetAppName,
        })
        const firstIdx = nextIndexForName(
          existingInNewApp.map((m) => m.name),
          'agent',
        )
        const firstAgentName = `agent-${firstIdx}`
        if (!isValidFlyName(firstAgentName)) {
          return toError(
            `Computed agent name '${firstAgentName}' is invalid; cannot create first agent.`,
          )
        }

        const createdMachine = await flyCliCreateMachine({
          appName: targetAppName,
          name: firstAgentName,
          config: machineConfig,
          image,
          region: machineRegion,
        })

        return toStructured({
          newComputer: { id: createdApp.id, name: createdApp.name },
          firstAgent: mapMachineSummary(createdMachine),
        })
      } catch (err) {
        return toFlyErrorResult(err)
      }
    },
  )
  server.registerTool(
    'list_computers',
    {
      title: 'List Computers',
      description: 'Lists Computers reachable from the current app context.',
      inputSchema: {},
      outputSchema: listComputersOutput.shape,
    },
    async (): Promise<CallToolResult> => {
      try {
        const currentApp = (getEnv('FLY_APP_NAME') ?? '').trim()
        if (!currentApp) {
          return toError(
            'Missing current app name. Set FLY_APP_NAME so the organization can be inferred.',
          )
        }
        const appInfo = await flyCliAppsInfo({
          appName: currentApp,
        })
        const orgSlug = (appInfo.organizationSlug ?? '').trim()
        if (!orgSlug) {
          return toError(
            'Unable to infer organization from current app. Ensure FLY_APP_NAME points to an existing app your token can access.',
          )
        }
        const apps = await flyCliAppsList({ orgSlug })
        return toStructured({
          computers: apps.map((a) => ({
            id: a.id,
            name: a.name,
            createdAt: a.createdAt,
            organizationSlug: a.organizationSlug,
          })),
        })
      } catch (err) {
        return toFlyErrorResult(err)
      }
    },
  )
  server.registerTool(
    'read_computer',
    {
      title: 'Read Computer',
      description:
        "Reads the Computer named 'computer-user-<userId>'. Returns { exists: true, computer: {...} } if found, otherwise { exists: false }.",
      inputSchema: { userId: z.string() },
      outputSchema: readComputerOutput.shape,
    },
    async ({ userId }): Promise<CallToolResult> => {
      try {
        const name = buildComputerNameFromUserId(userId)
        if (!isValidFlyName(name)) return toStructured({ exists: false })
        const exists = await appExists(name)
        if (!exists) return toStructured({ exists: false })
        const info = await flyCliAppsInfo({ appName: name })
        return toStructured({ exists: true, computer: info })
      } catch (err) {
        return toFlyErrorResult(err)
      }
    },
  )
  server.registerTool(
    'destroy_computer',
    {
      title: 'Destroy Computer',
      description:
        'Destroys a Computer, which will also remove its Agents. Refuses to delete the current Computer.',
      inputSchema: {
        name: z.string().optional(),
        force: z.boolean().optional(),
      },
      outputSchema:
        z.object({ destroyed: z.boolean(), name: z.string() }).shape,
    },
    async ({ name, force }): Promise<CallToolResult> => {
      const currentApp = (getEnv('FLY_APP_NAME') ?? '').trim()
      const targetApp = (name ?? currentApp).trim()
      if (!targetApp) return toError('Provide app name or set FLY_APP_NAME.')
      if (currentApp && targetApp === currentApp) {
        return toError('I cannot self terminate')
      }
      try {
        await flyCliAppsDestroy({
          appName: targetApp,
          force,
        })
        return toStructured({ destroyed: true, name: targetApp })
      } catch (err) {
        return toFlyErrorResult(err)
      }
    },
  )
  return server
}

const server = createServer()
const transport = new StdioServerTransport()
await server.connect(transport)
