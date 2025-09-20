import { join } from '@std/path'
import {
  createMachine as createFlyMachine,
  getFlyMachine,
  listMachines,
  type MachineDetail,
  type MachineSummary,
} from '@artifact/shared'

type Handler = (request: Request) => Promise<Response>

type CreateHandlerOptions = {
  config?: Partial<AppConfig>
  dependencies?: Partial<Dependencies>
}

type AppConfig = {
  flyApiToken: string
  targetApp: string
  agentImage: string
  nfsMountDir: string
  registrySubdir: string
  baseDomain?: string
  defaultRegion?: string
}

type MachineMapping = {
  machineId: string
  machineName?: string
  subdomain?: string
  createdAt?: string
  updatedAt?: string
}

type CreateMachineInput = {
  name: string
  config: Record<string, unknown>
  region?: string
}

type FlyApi = {
  getMachine: (machineId: string) => Promise<MachineDetail>
  listMachines: () => Promise<MachineSummary[]>
  createMachine: (input: CreateMachineInput) => Promise<MachineSummary>
  startMachine: (machineId: string) => Promise<void>
}

type Dependencies = {
  fetchImpl: typeof fetch
  readTextFile: typeof Deno.readTextFile
  writeTextFile: typeof Deno.writeTextFile
  mkdir: typeof Deno.mkdir
  now: () => Date
  fly: FlyApi
}

const API_BASE = 'https://api.machines.dev'

export async function createHandler(
  options: CreateHandlerOptions = {},
): Promise<Handler> {
  const config = resolveConfig(options.config)
  const deps: Dependencies = {
    fetchImpl: options.dependencies?.fetchImpl ?? fetch,
    readTextFile: options.dependencies?.readTextFile ?? Deno.readTextFile,
    writeTextFile: options.dependencies?.writeTextFile ?? Deno.writeTextFile,
    mkdir: options.dependencies?.mkdir ?? Deno.mkdir,
    now: options.dependencies?.now ?? (() => new Date()),
    fly: options.dependencies?.fly ??
      createDefaultFlyApi(config, options.dependencies?.fetchImpl ?? fetch),
  }

  const registryDir = join(config.nfsMountDir, config.registrySubdir)
  await deps.mkdir(registryDir, { recursive: true })

  async function handler(request: Request): Promise<Response> {
    const host = resolveHost(request)
    if (!host) return jsonError(400, 'missing host header')

    const rawSubdomain = deriveSubdomain(host, config.baseDomain)
    if (!rawSubdomain) return jsonError(404, 'unknown subdomain')

    const key = normalizeKey(rawSubdomain)
    if (!key) return jsonError(404, 'invalid subdomain')

    const mappingPath = join(registryDir, `${key}.json`)
    const nowIso = deps.now().toISOString()

    const existingMapping = await readMapping(mappingPath, deps)
    if (existingMapping) {
      const detail = await safeGetMachine(existingMapping.machineId, deps.fly)
      if (detail) {
        await ensureMachineStarted(detail, deps.fly)
        const updated: MachineMapping = {
          machineId: detail.id,
          machineName: detail.name ?? existingMapping.machineName,
          subdomain: existingMapping.subdomain ?? rawSubdomain,
          createdAt: existingMapping.createdAt ?? nowIso,
          updatedAt: nowIso,
        }
        await writeMapping(mappingPath, updated, deps)
        return replayResponse(config.targetApp, detail.id)
      }
    }

    const machines = await deps.fly.listMachines()
    const nameCandidate = buildMachineName(key)

    const match = findMatchingMachine(machines, key, nameCandidate)
    if (match) {
      const detail = await safeGetMachine(match.id, deps.fly)
      if (detail) {
        await ensureMachineStarted(detail, deps.fly)
        const mapping: MachineMapping = {
          machineId: detail.id,
          machineName: detail.name ?? nameCandidate,
          subdomain: rawSubdomain,
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        await writeMapping(mappingPath, mapping, deps)
        return replayResponse(config.targetApp, detail.id)
      }
    }

    const templateDetail = await selectTemplateMachine(
      match?.id,
      machines,
      deps.fly,
    )
    const configForMachine = buildMachineConfig(
      templateDetail?.config,
      config.agentImage,
      key,
    )

    const created = await deps.fly.createMachine({
      name: nameCandidate,
      config: configForMachine,
      region: config.defaultRegion,
    })

    const mapping: MachineMapping = {
      machineId: created.id,
      machineName: created.name ?? nameCandidate,
      subdomain: rawSubdomain,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    await writeMapping(mappingPath, mapping, deps)

    const detail = await safeGetMachine(created.id, deps.fly)
    if (detail) await ensureMachineStarted(detail, deps.fly)

    return replayResponse(config.targetApp, created.id)
  }

  return handler
}

function createDefaultFlyApi(
  config: AppConfig,
  fetchImpl: typeof fetch,
): FlyApi {
  return {
    getMachine: (machineId: string) =>
      getFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        machineId,
        fetchImpl,
      }),
    listMachines: () =>
      listMachines({
        appName: config.targetApp,
        token: config.flyApiToken,
        fetchImpl,
      }),
    createMachine: ({ name, config: machineConfig, region }) =>
      createFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        name,
        config: machineConfig,
        region,
        fetchImpl,
      }),
    startMachine: (machineId: string) =>
      startFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        machineId,
        fetchImpl,
      }),
  }
}

type StartFlyMachineBag = {
  appName: string
  token: string
  machineId: string
  fetchImpl: typeof fetch
}

async function startFlyMachine(
  { appName, token, machineId, fetchImpl }: StartFlyMachineBag,
): Promise<void> {
  const url = `${API_BASE}/v1/apps/${encodeURIComponent(appName)}/machines/${
    encodeURIComponent(machineId)
  }/start`
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  })
  const res = await fetchImpl(url, { method: 'POST', headers })
  if (res.ok) return
  if ([202, 204, 409, 423].includes(res.status)) return
  const body = await res.text().catch(() => '')
  throw new Error(
    `Failed to start machine ${machineId}: ${res.status} ${res.statusText}\n${body}`,
  )
}

function resolveConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const flyApiToken = overrides.flyApiToken ?? readEnv('FLY_API_TOKEN')
  const targetApp = overrides.targetApp ?? readEnv('FLY_COMPUTER_TARGET_APP')
  const agentImage = overrides.agentImage ?? readEnv('FLY_COMPUTER_AGENT_IMAGE')
  const nfsMountDir = overrides.nfsMountDir ??
    Deno.env.get('FLY_NFS_MOUNT_DIR') ?? '/mnt/fly-nfs'
  const registrySubdir = overrides.registrySubdir ??
    Deno.env.get('FLY_COMPUTER_REGISTRY_SUBDIR') ?? 'computers'
  const baseDomain = overrides.baseDomain ??
    (Deno.env.get('FLY_COMPUTER_BASE_DOMAIN') ?? undefined)
  const defaultRegion = overrides.defaultRegion ??
    (Deno.env.get('FLY_COMPUTER_REGION') ?? undefined)

  if (!flyApiToken.trim()) throw new Error('Missing FLY_API_TOKEN')
  if (!targetApp.trim()) throw new Error('Missing FLY_COMPUTER_TARGET_APP')
  if (!agentImage.trim()) throw new Error('Missing FLY_COMPUTER_AGENT_IMAGE')

  return {
    flyApiToken,
    targetApp,
    agentImage,
    nfsMountDir,
    registrySubdir,
    baseDomain,
    defaultRegion,
  }
}

function readEnv(key: string): string {
  const value = Deno.env.get(key) ?? ''
  return value
}

function resolveHost(request: Request): string | undefined {
  const headers = request.headers
  const candidates = [
    headers.get('fly-original-host'),
    headers.get('x-forwarded-host'),
    headers.get('host'),
  ]
  for (const candidate of candidates) {
    const picked = normalizeHost(candidate)
    if (picked) return picked
  }
  try {
    const url = new URL(request.url)
    return normalizeHost(url.host)
  } catch {
    return undefined
  }
}

function normalizeHost(candidate: string | null): string | undefined {
  if (!candidate) return undefined
  const first = candidate.split(',')[0]?.trim() ?? ''
  if (!first) return undefined
  const withoutPort = first.split(':')[0]?.trim() ?? ''
  return withoutPort ? withoutPort.toLowerCase() : undefined
}

function deriveSubdomain(
  host: string,
  baseDomain?: string,
): string | undefined {
  const normalizedHost = host.toLowerCase()
  if (!baseDomain || !baseDomain.trim()) {
    const parts = normalizedHost.split('.')
    return parts.length > 1 ? parts[0] : undefined
  }
  const normalizedBase = baseDomain.toLowerCase()
  if (normalizedHost === normalizedBase) return undefined
  if (normalizedHost.endsWith(`.${normalizedBase}`)) {
    const prefix = normalizedHost.slice(
      0,
      normalizedHost.length - normalizedBase.length,
    )
    const trimmed = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
    return trimmed || undefined
  }
  return undefined
}

function normalizeKey(value: string): string {
  const lower = value.toLowerCase()
  const replaced = lower.replace(/[^a-z0-9-]+/g, '-')
  const collapsed = replaced.replace(/-+/g, '-')
  return collapsed.replace(/^-+|-+$/g, '')
}

function buildMachineName(key: string): string {
  const prefix = 'computer-'
  const maxKeyLength = Math.max(1, 63 - prefix.length)
  let trimmed = key.slice(0, maxKeyLength)
  if (!trimmed) trimmed = 'x'
  const sanitized = trimmed.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  const finalKey = sanitized || 'x'
  return `${prefix}${finalKey}`.slice(0, 63)
}

function findMatchingMachine(
  machines: MachineSummary[],
  key: string,
  nameCandidate: string,
): MachineSummary | undefined {
  const byMetadata = machines.find((m) =>
    (m.metadata?.artifact_subdomain as string | undefined) === key
  )
  if (byMetadata) return byMetadata
  return machines.find((m) => (m.name ?? '') === nameCandidate)
}

async function selectTemplateMachine(
  excludeId: string | undefined,
  machines: MachineSummary[],
  fly: FlyApi,
): Promise<MachineDetail | undefined> {
  const candidate = machines.find((m) => m.id !== excludeId)
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
  key: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = template
    ? structuredClone(template)
    : {}
  base.image = image
  const metadata = (base.metadata as Record<string, unknown> | undefined) ?? {}
  metadata.artifact_subdomain = key
  base.metadata = metadata
  return base
}

async function safeGetMachine(
  machineId: string,
  fly: FlyApi,
): Promise<MachineDetail | undefined> {
  try {
    return await fly.getMachine(machineId)
  } catch (err) {
    if (err instanceof Error && /Fly API error\s+404/.test(err.message)) {
      return undefined
    }
    throw err
  }
}

async function ensureMachineStarted(
  detail: MachineDetail,
  fly: FlyApi,
): Promise<void> {
  const state = (detail.state ?? '').toLowerCase()
  if (state === 'started' || state === 'starting') return
  await fly.startMachine(detail.id)
}

async function readMapping(
  path: string,
  deps: Pick<Dependencies, 'readTextFile'>,
): Promise<MachineMapping | undefined> {
  try {
    const text = await deps.readTextFile(path)
    const data = JSON.parse(text) as Record<string, unknown>
    const machineId = typeof data.machineId === 'string'
      ? data.machineId
      : undefined
    if (!machineId) return undefined
    return {
      machineId,
      machineName: typeof data.machineName === 'string'
        ? data.machineName
        : undefined,
      subdomain: typeof data.subdomain === 'string'
        ? data.subdomain
        : undefined,
      createdAt: typeof data.createdAt === 'string'
        ? data.createdAt
        : undefined,
      updatedAt: typeof data.updatedAt === 'string'
        ? data.updatedAt
        : undefined,
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined
    if (err instanceof SyntaxError) return undefined
    throw err
  }
}

async function writeMapping(
  path: string,
  mapping: MachineMapping,
  deps: Pick<Dependencies, 'writeTextFile'>,
): Promise<void> {
  const body = JSON.stringify(mapping, null, 2) + '\n'
  await deps.writeTextFile(path, body)
}

function replayResponse(appName: string, machineId: string): Response {
  const headers = new Headers({
    'fly-replay': `app=${appName};instance=${machineId}`,
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

export type { AppConfig, CreateHandlerOptions }
