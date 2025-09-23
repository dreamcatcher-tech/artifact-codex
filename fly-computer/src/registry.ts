import { generateFlyMachineName } from '@artifact/shared'
import { join } from '@std/path'

import { z } from 'zod'

import { slugify } from './naming.ts'

const machineSnapshotSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  image: z.string().optional(),
  updatedAt: z.string().optional(),
}).partial()

const agentConfigSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  parentId: z.union([z.string(), z.number(), z.null()]).optional(),
  machine: machineSnapshotSchema.optional(),
}).passthrough()

export type MachineSnapshot = z.infer<typeof machineSnapshotSchema>
export type AgentConfig = z.infer<typeof agentConfigSchema>

export type AgentRecord = {
  id: string
  name: string
  parentId?: string
  slug: string
  configPath: string
  dirPath: string
  config: AgentConfig
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
  createAgent: (options?: CreateAgentOptions) => Promise<AgentRecord>
}

type FsDependencies = {
  readDir: typeof Deno.readDir
  readTextFile: typeof Deno.readTextFile
  writeTextFile: typeof Deno.writeTextFile
  stat: typeof Deno.stat
  mkdir: typeof Deno.mkdir
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
  }

  async function loadAgents(): Promise<Map<string, AgentRecord>> {
    const agents = new Map<string, AgentRecord>()

    try {
      for await (const entry of deps.readDir(root)) {
        if (!entry.isDirectory) continue
        if (!/^\d+$/.test(entry.name)) continue
        const dirPath = join(root, entry.name)
        const configPath = join(dirPath, 'config.json')
        let raw: AgentConfig | undefined
        try {
          const text = await deps.readTextFile(configPath)
          raw = parseAgentConfig(text)
        } catch (err) {
          if (err instanceof Deno.errors.NotFound) continue
          throw err
        }

        if (!raw) continue

        const id = toId(raw.id ?? entry.name)
        const name = toName(raw.name)
        if (!name) continue
        const parentId = raw.parentId !== undefined && raw.parentId !== null
          ? toId(raw.parentId)
          : undefined
        const slug = slugify(name)
        const record: AgentRecord = {
          id,
          name,
          parentId,
          slug,
          configPath,
          dirPath,
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
    const current = isPlainObject(record.config.machine)
      ? { ...record.config.machine }
      : {}
    const next: MachineSnapshot = {
      ...current,
      id: update.id,
      name: update.name ?? current.name,
      image: update.image ?? current.image,
      updatedAt: update.updatedAt,
    }
    const updatedConfig: AgentConfig = {
      ...record.config,
      id: record.config.id ?? agentId,
      name: record.config.name ?? record.name,
      machine: next,
    }
    const validated = agentConfigSchema.parse(updatedConfig)
    const body = JSON.stringify(validated, null, 2) + '\n'
    await deps.writeTextFile(record.configPath, body)
  }

  async function createAgent(
    options: CreateAgentOptions = {},
  ): Promise<AgentRecord> {
    await ensureReady()
    const existingAgents = await loadAgents()

    const dirName = await nextDirectoryName(existingAgents)
    const dirPath = join(root, dirName)
    try {
      await deps.mkdir(dirPath, { recursive: false })
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        return createAgent(options)
      }
      throw error
    }

    const agentId = crypto.randomUUID()
    const name = options.name?.trim() || defaultAgentName()
    const parentId = options.parentId
    const config: AgentConfig = {
      id: agentId,
      name,
      parentId,
    }
    const validated = agentConfigSchema.parse(config)
    const body = JSON.stringify(validated, null, 2) + '\n'
    const configPath = join(dirPath, 'config.json')
    await deps.writeTextFile(configPath, body)

    const slug = slugify(name)
    const record: AgentRecord = {
      id: agentId,
      name,
      parentId,
      slug,
      configPath,
      dirPath,
      config: validated,
    }
    return record
  }

  return { ensureReady, findByPath, updateMachine, createAgent }
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
    segments.push(current.slug)
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

function nextDirectoryName(
  agents: Map<string, AgentRecord>,
): string {
  const existing = new Set<number>()
  for (const record of agents.values()) {
    const parts = record.dirPath.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    const parsed = Number.parseInt(last ?? '', 10)
    if (Number.isFinite(parsed)) existing.add(parsed)
  }
  let candidate = existing.size
  while (existing.has(candidate)) {
    candidate += 1
  }
  return String(candidate)
}

function defaultAgentName(): string {
  return generateFlyMachineName()
}

function toId(value: string | number): string {
  return String(value)
}

function toName(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
