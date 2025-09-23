import {
  type MachineDetail,
  type MachineSummary,
  mapMachineDetail,
} from '@artifact/shared'

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
import {
  buildAgentHost,
  type HostResolution,
  resolveComputerHost,
  resolveHost,
} from './routing.ts'
import { flyCliAppStatus, flyCliGetMachine } from '@artifact/tasks'
import Debug from 'debug'

const log = Debug('@artifact/fly-computer:app')
const requestLog = log.extend('request')
const agentLog = log.extend('agent')
const machineLog = log.extend('machine')
const errorLog = log.extend('error')

export type AppHandler = (request: Request) => Promise<Response>

export type CreateAppOptions = {
  config?: ConfigOverrides
  dependencies?: Partial<Dependencies>
}

type Dependencies = {
  now: () => Date
  fly: FlyApi
  registry: AgentRegistry
  loadTemplateMachine: () => Promise<MachineDetail>
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<AppHandler> {
  const config = resolveConfig(options.config)
  const now = options.dependencies?.now ?? (() => new Date())
  const registryRoot = config.registryRoot
  const registry = options.dependencies?.registry ??
    createAgentRegistry(registryRoot, {
      readDir: Deno.readDir,
      readTextFile: Deno.readTextFile,
      writeTextFile: Deno.writeTextFile,
      stat: Deno.stat,
      mkdir: Deno.mkdir,
    })
  const fly = options.dependencies?.fly ?? createFlyApi(config)
  const loadTemplateMachine = options.dependencies?.loadTemplateMachine ??
    createTemplateMachineLoader(config)

  await registry.ensureReady()

  const deps: Dependencies = { now, fly, registry, loadTemplateMachine }

  return async (request: Request): Promise<Response> => {
    const host = resolveHost(request)
    if (!host) {
      errorLog('missing host header url=%s', request.url)
      return jsonError(400, 'missing host header')
    }

    requestLog(
      'incoming host=%s method=%s url=%s',
      host,
      request.method,
      request.url,
    )

    const hostInfo = resolveComputerHost(host, config.baseDomain)
    if (!hostInfo || !hostInfo.computer) {
      errorLog(
        'unable to resolve computer host=%s base=%s',
        host,
        config.baseDomain,
      )
      return jsonError(404, 'computer not found')
    }

    const { computer, agentPath } = hostInfo

    if (agentPath.length === 0) {
      return handleLandingRequest({
        request,
        host,
        hostInfo,
        config,
        deps,
      })
    }

    const agent = await deps.registry.findByPath(agentPath)
    if (!agent) {
      errorLog('agent not found host=%s path=%o', host, agentPath)
      return jsonError(404, 'agent not found')
    }

    agentLog(
      'resolving agent id=%s name="%s" slug=%s computer=%s host=%s',
      agent.id,
      agent.name,
      agent.slug,
      computer,
      host,
    )

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
      machineLog(
        'using configured machine id=%s agent=%s',
        configuredId,
        agent.id,
      )
      await ensureMachineRunning(detail, deps.fly)
      return detail
    }
    machineLog(
      'configured machine missing id=%s agent=%s',
      configuredId,
      agent.id,
    )
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
      machineLog(
        'found metadata machine id=%s agent=%s',
        metadataMatch.id,
        agent.id,
      )
      await ensureMachineRunning(detail, deps.fly)
      return detail
    }
  }

  const template = await selectTemplateMachine(machines, config, deps)
  const templateImage =
    (template ? extractMachineImage(template) : undefined) ??
      config.agentImage
  if (!templateImage) {
    throw new Error('Unable to determine agent machine image')
  }
  const machineName = buildMachineName(agent)
  const machineConfig = buildMachineConfig(
    template?.config as Record<string, unknown> | undefined,
    templateImage,
    agent.id,
  )

  machineLog(
    'creating machine name=%s agent=%s image=%s region=%s',
    machineName,
    agent.id,
    templateImage,
    config.defaultRegion ?? 'default',
  )
  const created = await deps.fly.createMachine({
    name: machineName,
    config: machineConfig,
    image: templateImage,
    region: config.defaultRegion,
  })

  const detail = await safeGetMachine(deps.fly, created.id) ?? {
    ...created,
    config: machineConfig,
  }
  machineLog('created machine id=%s agent=%s', detail.id, agent.id)
  await ensureMachineRunning(detail, deps.fly)
  return detail
}

async function selectTemplateMachine(
  machines: MachineSummary[],
  config: AppConfig,
  deps: Dependencies,
): Promise<MachineDetail | undefined> {
  const candidate = machines[0]
  if (!candidate) {
    try {
      machineLog(
        'no machines available; loading template from app=%s',
        config.agentTemplateApp,
      )
      return await deps.loadTemplateMachine()
    } catch {
      return undefined
    }
  }
  try {
    const detail = await deps.fly.getMachine(candidate.id)
    machineLog('selected existing machine id=%s for template', candidate.id)
    return detail
  } catch {
    try {
      machineLog(
        'failed to inspect machine id=%s; loading template app=%s',
        candidate.id,
        config.agentTemplateApp,
      )
      return await deps.loadTemplateMachine()
    } catch {
      return undefined
    }
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
  errorLog('responding status=%d message=%s', status, message)
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type LandingContext = {
  request: Request
  host: string
  hostInfo: HostResolution
  config: AppConfig
  deps: Dependencies
}

async function handleLandingRequest(
  { request, host, hostInfo, config, deps }: LandingContext,
): Promise<Response> {
  agentLog('landing request host=%s computer=%s', host, hostInfo.computer)
  const agent = await deps.registry.createAgent()
  agentLog(
    'created agent id=%s name="%s" slug=%s',
    agent.id,
    agent.name,
    agent.slug,
  )
  const detail = await reconcileMachine(agent, config, deps)
  const machineUpdate: MachineUpdate = {
    id: detail.id,
    name: detail.name,
    image: extractMachineImage(detail),
    updatedAt: deps.now().toISOString(),
  }
  await deps.registry.updateMachine(agent.id, machineUpdate)

  const location = buildAgentRedirectUrl({
    request,
    computer: hostInfo.computer!,
    agentPath: [agent.slug],
    baseDomain: config.baseDomain,
  })
  agentLog('redirecting host=%s to location=%s', host, location)
  return new Response(null, {
    status: 302,
    headers: {
      location,
    },
  })
}

type RedirectContext = {
  request: Request
  computer: string
  agentPath: string[]
  baseDomain: string
}

function buildAgentRedirectUrl(
  { request, computer, agentPath, baseDomain }: RedirectContext,
): string {
  const url = new URL(request.url)
  const updatedHost = buildAgentHost(agentPath, computer, baseDomain)
  url.hostname = updatedHost
  url.port = ''
  return url.toString()
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

function createTemplateMachineLoader(
  config: AppConfig,
): () => Promise<MachineDetail> {
  let cached: Promise<MachineDetail> | null = null
  return async () => {
    if (!cached) {
      cached = loadTemplateMachine(config.agentTemplateApp)
    }
    return await cached
  }
}

async function loadTemplateMachine(appName: string): Promise<MachineDetail> {
  const status = await flyCliAppStatus({ appName })
  const firstMachine = status.machines[0]
  if (!firstMachine?.id) {
    throw new Error(
      `Template app '${appName}' has no machines to clone configuration from`,
    )
  }
  machineLog(
    'loading template machine id=%s from app=%s',
    firstMachine.id,
    appName,
  )
  const detail = await flyCliGetMachine({
    appName,
    machineId: firstMachine.id,
  })
  return mapMachineDetail(detail)
}
