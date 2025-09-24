import { generateFlyMachineName } from '@artifact/shared'
import { join } from '@std/path'

import { z } from 'zod'

import { slugify } from './naming.ts'

const AGENTS_DIR_NAME = 'agents'
const MACHINES_DIR_NAME = 'machines'

const agentConfigSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  parentId: z.union([z.string(), z.number(), z.null()]).optional(),
}).passthrough()

const machineRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  agentId: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  image: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough()

export type AgentConfig = z.infer<typeof agentConfigSchema>
export type MachineRecordData = z.infer<typeof machineRecordSchema>

export type AgentRecord = {
  id: string
  name: string
  parentId?: string
  pathSegment: string
  configPath: string
  config: AgentConfig
}

export type MachineRecord = {
  id: string
  agentId: string
  name?: string
  image?: string
  updatedAt?: string
  filePath: string
  data: MachineRecordData
}

export type MachineUpdate = {
  id: string
  name?: string
  image?: string
  updatedAt: string
}

export type AgentRegistry = {
  ensureReady: () => Promise<void>
  findByPath: (slugs: string[]) => Promise<AgentRecord | undefined>
  updateMachine: (agentId: string, update: MachineUpdate) => Promise<void>
  findMachineByAgent: (agentId: string) => Promise<MachineRecord | undefined>
  removeMachine: (machineId: string) => Promise<void>
  createAgent: (options?: CreateAgentOptions) => Promise<AgentRecord>
}

type FsDependencies = {
  readDir: typeof Deno.readDir
  readTextFile: typeof Deno.readTextFile
  writeTextFile: typeof Deno.writeTextFile
  stat: typeof Deno.stat
  mkdir: typeof Deno.mkdir
  remove: typeof Deno.remove
}

export type CreateAgentOptions = {
  name?: string
  parentId?: string
}

export function createAgentRegistry(
  root: string,
  deps: FsDependencies,
): AgentRegistry {
  async function ensureReady() {
    try {
      await deps.mkdir(root, { recursive: true })
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err
    }

    try {
      const info = await deps.stat(root)
      if (!info.isDirectory) {
        throw new Error(
          `Registry root '${root}' exists but is not a directory; fly-computer cannot continue.`,
        )
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new Error(
          `Registry root '${root}' not found; ensure the shared volume is mounted at /mnt/computer (computers/<fly app name> subpath).`,
        )
      }
      throw err
    }

    await ensureRegistrySubdir(AGENTS_DIR_NAME)
    await ensureRegistrySubdir(MACHINES_DIR_NAME)
  }

  async function ensureRegistrySubdir(name: string) {
    const dirPath = join(root, name)
    try {
      await deps.mkdir(dirPath, { recursive: true })
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err
    }

    try {
      const info = await deps.stat(dirPath)
      if (!info.isDirectory) {
        throw new Error(
          `Registry path '${dirPath}' exists but is not a directory; fly-computer cannot continue.`,
        )
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new Error(
          `Registry path '${dirPath}' not found; ensure the shared volume is mounted at /mnt/computer (computers/<fly app name> subpath).`,
        )
      }
      throw err
    }
  }

  async function loadAgents(): Promise<Map<string, AgentRecord>> {
    const agents = new Map<string, AgentRecord>()
    const agentsDir = join(root, AGENTS_DIR_NAME)

    try {
      for await (const entry of deps.readDir(agentsDir)) {
        if (entry.isDirectory) continue
        if (!entry.name.toLowerCase().endsWith('.json')) continue
        const configPath = join(agentsDir, entry.name)
        let raw: AgentConfig | undefined
        try {
          const text = await deps.readTextFile(configPath)
          raw = parseAgentConfig(text)
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) continue
          throw err
        }

        if (!raw) continue

        const id = toId(
          raw.id ?? stripJsonExtension(entry.name),
        )
        const name = toName(raw.name)
        if (!name) continue
        const parentId = raw.parentId !== undefined && raw.parentId !== null
          ? toId(raw.parentId)
          : undefined
        const pathSegment = resolveAgentSegment(raw, name, id)
        const record: AgentRecord = {
          id,
          name,
          parentId,
          pathSegment,
          configPath,
          config: raw,
        }
        agents.set(id, record)
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return agents
      }
      throw err
    }

    return agents
  }

  async function findByPath(slugs: string[]): Promise<AgentRecord | undefined> {
    const normalized = slugs.map((slug) => slugify(slug)).filter(Boolean)
    if (normalized.length === 0) return undefined

    const agents = await loadAgents()
    const pathCache = new Map<string, string[]>()

    for (const record of agents.values()) {
      const path = computePath(record, agents, pathCache)
      if (!path) continue
      if (path.length !== normalized.length) continue
      if (matchesPath(path, normalized)) {
        return record
      }
    }
    return undefined
  }

  async function updateMachine(agentId: string, update: MachineUpdate) {
    const agents = await loadAgents()
    const record = agents.get(agentId)
    if (!record) {
      throw new Error(`Agent ${agentId} not found in registry`)
    }

    await persistAgentConfig(record)

    const machineData = machineRecordSchema.parse({
      id: update.id,
      agentId,
      name: update.name,
      image: update.image,
      updatedAt: update.updatedAt,
    })
    const normalizedId = toId(machineData.id)
    const normalized: Record<string, unknown> = {
      ...machineData,
      id: normalizedId,
      agentId,
    }
    const machineFilePath = machineFilePathFor(normalizedId)
    const body = JSON.stringify(normalized, null, 2) + '\n'
    await deps.writeTextFile(machineFilePath, body)
    await pruneOldMachineRecords(agentId, normalizedId)
  }

  async function findMachineByAgent(
    agentId: string,
  ): Promise<MachineRecord | undefined> {
    const machinesDir = join(root, MACHINES_DIR_NAME)
    try {
      for await (const entry of deps.readDir(machinesDir)) {
        if (entry.isDirectory) continue
        if (!entry.name.toLowerCase().endsWith('.json')) continue
        const filePath = join(machinesDir, entry.name)
        let parsed: MachineRecordData | undefined
        try {
          const text = await deps.readTextFile(filePath)
          parsed = parseMachineRecord(text)
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) continue
          throw err
        }
        if (!parsed) continue
        if (toId(parsed.agentId) !== agentId) continue
        const normalizedId = toId(parsed.id)
        return {
          id: normalizedId,
          agentId,
          name: typeof parsed.name === 'string' ? parsed.name : undefined,
          image: typeof parsed.image === 'string' ? parsed.image : undefined,
          updatedAt: typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : undefined,
          filePath,
          data: parsed,
        }
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return undefined
      }
      throw err
    }
    return undefined
  }

  async function removeMachine(machineId: string): Promise<void> {
    const filePath = machineFilePathFor(machineId)
    try {
      await deps.remove(filePath)
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return
      throw err
    }
  }

  async function createAgent(
    options: CreateAgentOptions = {},
  ): Promise<AgentRecord> {
    await ensureReady()

    const agentId = crypto.randomUUID()
    const name = resolveAgentName(options.name)
    const parentId = options.parentId
    const configData: Record<string, unknown> = {
      id: agentId,
      name,
    }
    if (parentId !== undefined) {
      configData.parentId = parentId
    }
    const validated = agentConfigSchema.parse(configData)
    const configPath = join(root, AGENTS_DIR_NAME, `${agentId}.json`)
    const body = JSON.stringify(validated, null, 2) + '\n'
    await deps.writeTextFile(configPath, body)

    const pathSegment = resolveAgentSegment(validated, name, agentId)
    const record: AgentRecord = {
      id: agentId,
      name,
      parentId,
      pathSegment,
      configPath,
      config: validated,
    }
    return record
  }

  function machineFilePathFor(machineId: string): string {
    const normalized = machineId.trim().toLowerCase()
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      throw new Error(`Invalid machine id '${machineId}' for registry filename`)
    }
    return join(root, MACHINES_DIR_NAME, `${normalized}.json`)
  }

  async function pruneOldMachineRecords(agentId: string, keepId: string) {
    const machinesDir = join(root, MACHINES_DIR_NAME)
    try {
      for await (const entry of deps.readDir(machinesDir)) {
        if (entry.isDirectory) continue
        if (!entry.name.toLowerCase().endsWith('.json')) continue
        const filePath = join(machinesDir, entry.name)
        let parsed: MachineRecordData | undefined
        try {
          const text = await deps.readTextFile(filePath)
          parsed = parseMachineRecord(text)
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) continue
          throw err
        }
        if (!parsed) continue
        if (toId(parsed.agentId) !== agentId) continue
        if (toId(parsed.id) === keepId) continue
        try {
          await deps.remove(filePath)
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) continue
          throw err
        }
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return
      throw err
    }
  }

  async function persistAgentConfig(record: AgentRecord) {
    const data: Record<string, unknown> = { ...record.config }
    data.id = record.config.id ?? record.id
    data.name = record.config.name ?? record.name
    if (record.parentId !== undefined) {
      data.parentId = record.parentId
    } else if (data.parentId === undefined) {
      delete data.parentId
    }
    delete (data as { slug?: unknown }).slug
    delete (data as { machine?: unknown }).machine

    const validated = agentConfigSchema.parse(data)
    const body = JSON.stringify(validated, null, 2) + '\n'
    await deps.writeTextFile(record.configPath, body)
    record.config = validated
  }

  return {
    ensureReady,
    findByPath,
    updateMachine,
    findMachineByAgent,
    removeMachine,
    createAgent,
  }
}

function parseAgentConfig(body: string): AgentConfig | undefined {
  try {
    const data = JSON.parse(body)
    const result = agentConfigSchema.safeParse(data)
    if (result.success) return result.data
  } catch {
    // ignore
  }
}

function parseMachineRecord(body: string): MachineRecordData | undefined {
  try {
    const data = JSON.parse(body)
    const result = machineRecordSchema.safeParse(data)
    if (result.success) return result.data
  } catch {
    // ignore
  }
}

function computePath(
  record: AgentRecord,
  agents: Map<string, AgentRecord>,
  cache: Map<string, string[]>,
): string[] | undefined {
  if (cache.has(record.id)) return cache.get(record.id)

  const segments: string[] = []
  const seen = new Set<string>()
  let current: AgentRecord | undefined = record
  while (current) {
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    segments.push(current.pathSegment)
    if (!current.parentId) break
    current = agents.get(current.parentId)
  }
  if (current?.parentId) return undefined

  const path = segments.reverse()
  cache.set(record.id, path)
  return path
}

function matchesPath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((segment, index) => segment === b[index])
}

function defaultAgentName(): string {
  return generateFlyMachineName()
}

function resolveAgentName(requestedName?: string): string {
  const trimmed = requestedName?.trim()
  if (trimmed) return trimmed
  return defaultAgentName()
}

function resolveAgentSegment(
  config: AgentConfig,
  name: string,
  agentId: string,
): string {
  const legacySlug = typeof (config as { slug?: unknown }).slug === 'string'
    ? slugify(String((config as { slug?: unknown }).slug))
    : undefined
  if (legacySlug) return legacySlug
  return deriveAgentSegment(name, agentId)
}

function deriveAgentSegment(name: string, agentId: string): string {
  const idFragment =
    agentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10) || 'agent'
  const base = slugify(name).slice(0, 16)
  const trimmedBase = base.replace(/^-+|-+$/g, '')
  const combined = trimmedBase ? `${trimmedBase}-${idFragment}` : idFragment
  const normalized = slugify(combined)
  return normalized || idFragment
}

function stripJsonExtension(filename: string): string {
  return filename.toLowerCase().endsWith('.json')
    ? filename.slice(0, -5)
    : filename
}

function toId(value: string | number): string {
  return String(value)
}

function toName(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}
