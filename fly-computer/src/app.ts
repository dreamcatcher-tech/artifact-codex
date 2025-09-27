import {
  type MachineDetail,
  mapMachineDetail,
  setFlyMachineHeader,
  withFlyMachineHeader,
} from '@artifact/shared'

import { type ConfigOverrides, resolveConfig } from './config.ts'
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
} from './registry.ts'
import { buildAgentHost, resolveComputerHost, resolveHost } from './routing.ts'
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
  dependencies?: Partial<{
    now: () => Date
    fly: FlyApi
    registry: AgentRegistry
    loadTemplateMachine: () => Promise<MachineDetail>
  }>
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<AppHandler> {
  const config = resolveConfig(options.config)
  const now = options.dependencies?.now ?? (() => new Date())
  const registry = options.dependencies?.registry ??
    createAgentRegistry(config.registryRoot, {
      readDir: Deno.readDir,
      readTextFile: Deno.readTextFile,
      writeTextFile: Deno.writeTextFile,
      stat: Deno.stat,
      mkdir: Deno.mkdir,
      remove: Deno.remove,
    })
  const fly = options.dependencies?.fly ?? createFlyApi(config)
  const loadTemplate = options.dependencies?.loadTemplateMachine ??
    (() => loadTemplateMachine(config.agentTemplateApp))

  let templateMachine: Promise<MachineDetail> | null = null
  const getTemplateMachine = () =>
    templateMachine ?? (templateMachine = loadTemplate())

  await registry.ensureReady()

  const ensureAgentMachine = async (
    agent: AgentRecord,
  ): Promise<MachineDetail> => {
    const recorded = await registry.findMachineByAgent(agent.id)
    if (recorded) {
      const detail = await safeGetMachine(fly, recorded.id)
      if (detail) {
        machineLog(
          'using recorded machine id=%s agent=%s',
          recorded.id,
          agent.id,
        )
        await ensureMachineRunning(detail, fly)
        return detail
      }
      machineLog(
        'recorded machine missing id=%s agent=%s; removing',
        recorded.id,
        agent.id,
      )
      await registry.removeMachine(recorded.id)
    }

    const template = await getTemplateMachine()
    const image = config.agentImage ?? extractMachineImage(template)
    if (!image) {
      throw new Error(
        'Unable to determine agent machine image from template app',
      )
    }

    const machineConfig: Record<string, unknown> =
      isPlainObject(template.config)
        ? { ...(template.config as Record<string, unknown>) }
        : {}
    const metadata: Record<string, unknown> =
      isPlainObject(machineConfig.metadata)
        ? { ...(machineConfig.metadata as Record<string, unknown>) }
        : {}
    delete metadata.fly_platform_version
    metadata[AGENT_METADATA_KEY] = agent.id
    machineConfig.image = image
    machineConfig.metadata = metadata

    const rawName = `${agent.pathSegment || 'agent'}-${agent.id}`
    const normalized = rawName.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
    const trimmed = normalized.replace(/^-+|-+$/g, '') || `agent-${agent.id}`
    const machineName = trimmed.slice(0, 63)

    machineLog(
      'creating machine via run name=%s agent=%s image=%s region=%s',
      machineName,
      agent.id,
      image,
      config.defaultRegion ?? 'default',
    )
    const created = await fly.runMachine({
      name: machineName,
      config: machineConfig,
      image,
      region: config.defaultRegion,
    })

    const detail = await safeGetMachine(fly, created.id) ?? {
      ...created,
      config: machineConfig,
    }
    machineLog('created machine id=%s agent=%s', detail.id, agent.id)
    await ensureMachineRunning(detail, fly)
    return detail
  }

  const updateMachineRecord = async (
    agentId: string,
    detail: MachineDetail,
  ) => {
    await registry.updateMachine(agentId, {
      id: detail.id,
      name: detail.name,
      image: extractMachineImage(detail),
      updatedAt: now().toISOString(),
    })
  }

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

    const computer = hostInfo.computer as string
    const agentPath = hostInfo.agentPath

    if (agentPath.length === 0) {
      agentLog('landing request host=%s computer=%s', host, computer)
      const agent = await registry.createAgent()
      agentLog(
        'created agent id=%s name="%s" segment=%s',
        agent.id,
        agent.name,
        agent.pathSegment,
      )

      const detail = await ensureAgentMachine(agent)
      await updateMachineRecord(agent.id, detail)

      const redirectUrl = new URL(request.url)
      redirectUrl.hostname = buildAgentHost(
        [agent.pathSegment],
        computer,
        config.baseDomain,
      )
      redirectUrl.protocol = 'https:'
      redirectUrl.port = ''

      agentLog(
        'redirecting host=%s to location=%s',
        host,
        redirectUrl.toString(),
      )
      return withFlyMachineHeader(
        new Response(null, {
          status: 302,
          headers: { location: redirectUrl.toString() },
        }),
      )
    }

    const agent = await registry.findByPath(agentPath)
    if (!agent) {
      errorLog('agent not found host=%s path=%o', host, agentPath)
      return jsonError(404, 'agent not found')
    }

    agentLog(
      'resolving agent id=%s name="%s" segment=%s computer=%s host=%s',
      agent.id,
      agent.name,
      agent.pathSegment,
      computer,
      host,
    )

    const detail = await ensureAgentMachine(agent)
    await updateMachineRecord(agent.id, detail)

    const headers = new Headers({
      'fly-replay':
        `app=${config.targetApp};fly_force_instance_id=${detail.id}`,
    })
    setFlyMachineHeader(headers)
    return new Response(null, { status: 204, headers })
  }
}

function jsonError(status: number, message: string): Response {
  const body = JSON.stringify({ error: message })
  errorLog('responding status=%d message=%s', status, message)
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return withFlyMachineHeader(response)
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
