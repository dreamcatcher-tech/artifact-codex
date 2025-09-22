import type { MachineDetail, MachineSummary } from '@artifact/shared'

import {
  type AppConfig,
  type ConfigOverrides,
  resolveConfig,
} from './config.ts'
import {
  AGENT_METADATA_KEY,
  createFlyApi,
  ensureMachineRunning,
  type FlyApi,
  safeGetMachine,
} from './fly.ts'
import {
  type AgentRecord,
  type AgentRegistry,
  createAgentRegistry,
  type MachineUpdate,
} from './registry.ts'
import { extractAgentPath, resolveHost } from './routing.ts'

export type Handler = (request: Request) => Promise<Response>

export type CreateHandlerOptions = {
  config?: ConfigOverrides
  dependencies?: Partial<Dependencies>
}

type Dependencies = {
  now: () => Date
  fly: FlyApi
  registry: AgentRegistry
}

export async function createHandler(
  options: CreateHandlerOptions = {},
): Promise<Handler> {
  const config = resolveConfig(options.config)
  const now = options.dependencies?.now ?? (() => new Date())
  const registryRoot = config.registryRoot
  const registry = options.dependencies?.registry ??
    createAgentRegistry(registryRoot, {
      readDir: Deno.readDir,
      readTextFile: Deno.readTextFile,
      writeTextFile: Deno.writeTextFile,
      stat: Deno.stat,
    })
  const fly = options.dependencies?.fly ?? createFlyApi(config)

  await registry.ensureReady()

  const deps: Dependencies = { now, fly, registry }

  return async (request: Request): Promise<Response> => {
    const host = resolveHost(request)
    if (!host) return jsonError(400, 'missing host header')

    const pathSegments = extractAgentPath(host)
    if (pathSegments.length === 0) return jsonError(404, 'unknown subdomain')

    const agent = await deps.registry.findByPath(pathSegments)
    if (!agent) return jsonError(404, 'agent not found')

    const detail = await reconcileMachine(agent, config, deps)
    const machineUpdate: MachineUpdate = {
      id: detail.id,
      name: detail.name,
      image: extractMachineImage(detail),
      updatedAt: deps.now().toISOString(),
    }
    await deps.registry.updateMachine(agent.id, machineUpdate)

    return replayResponse(config.targetApp, detail.id)
  }
}

async function reconcileMachine(
  agent: AgentRecord,
  config: AppConfig,
  deps: Dependencies,
): Promise<MachineDetail> {
  const machineFromConfig = agent.config.machine?.id
  const configuredId =
    machineFromConfig === undefined || machineFromConfig === null
      ? undefined
      : String(machineFromConfig)
  if (configuredId) {
    const detail = await safeGetMachine(deps.fly, configuredId)
    if (detail) {
      await ensureMachineRunning(detail, deps.fly)
      return detail
    }
  }

  const machines = await deps.fly.listMachines()

  const metadataMatch = machines.find((machine) => {
    const metadata = machine.metadata as Record<string, unknown> | undefined
    const value = typeof metadata?.[AGENT_METADATA_KEY] === 'string'
      ? String(metadata?.[AGENT_METADATA_KEY])
      : undefined
    return value === agent.id
  })

  if (metadataMatch) {
    const detail = await safeGetMachine(deps.fly, metadataMatch.id)
    if (detail) {
      await ensureMachineRunning(detail, deps.fly)
      return detail
    }
  }

  const template = await selectTemplateMachine(machines, deps.fly)
  const machineName = buildMachineName(agent)
  const machineConfig = buildMachineConfig(
    template?.config,
    config.agentImage,
    agent.id,
  )

  const created = await deps.fly.createMachine({
    name: machineName,
    config: machineConfig,
    region: config.defaultRegion,
  })

  const detail = await safeGetMachine(deps.fly, created.id) ?? {
    ...created,
    config: machineConfig,
  }
  await ensureMachineRunning(detail, deps.fly)
  return detail
}

async function selectTemplateMachine(
  machines: MachineSummary[],
  fly: FlyApi,
): Promise<MachineDetail | undefined> {
  const candidate = machines[0]
  if (!candidate) return undefined
  try {
    return await fly.getMachine(candidate.id)
  } catch {
    return undefined
  }
}

function buildMachineConfig(
  template: Record<string, unknown> | undefined,
  image: string,
  agentId: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = template
    ? structuredClone(template)
    : {}
  base.image = image
  const metadata = isPlainObject(base.metadata) ? { ...base.metadata } : {}
  metadata[AGENT_METADATA_KEY] = agentId
  base.metadata = metadata
  return base
}

function buildMachineName(agent: AgentRecord): string {
  const base = `${agent.slug || 'agent'}-${agent.id}`
  const normalized = base.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
  const trimmed = normalized.replace(/^-+|-+$/g, '') || `agent-${agent.id}`
  return trimmed.slice(0, 63)
}

function replayResponse(appName: string, machineId: string): Response {
  const headers = new Headers({
    'fly-replay': `app=${appName};fly_force_instance=${machineId}`,
  })
  return new Response(null, { status: 204, headers })
}

function jsonError(status: number, message: string): Response {
  const body = JSON.stringify({ error: message })
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function extractMachineImage(detail: MachineDetail): string | undefined {
  if (detail.config && isPlainObject(detail.config)) {
    const image = (detail.config as { image?: unknown }).image
    if (typeof image === 'string') return image
  }
  if (detail.image && typeof detail.image === 'string') return detail.image
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
