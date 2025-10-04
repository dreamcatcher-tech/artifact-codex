import { join } from '@std/path'
import { ensureDir } from '@std/fs'
import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_AGENTS,
  COMPUTER_EXEC,
  COMPUTER_REPOS,
  NFS_MOUNT_DIR,
  REPO_CONTAINER_IMAGES,
} from '@artifact/shared'
import { createReconciler } from '@artifact/fly-exec'
import { readImageRecord } from '@artifact/fly-nfs'
import type { ExecInstance, ImageRecord } from '@artifact/fly-nfs/schemas'
import { envs } from '@artifact/shared'

export type AgentSummary = {
  id: string
  name: string
  state?: string
  image?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type AgentDetail = AgentSummary & {
  config?: Record<string, unknown>
}

export type ReadAgentResult = {
  exists: boolean
  agent?: AgentDetail
  reason?: string
}

export type DestroyAgentArgs = {
  id?: string
  name?: string
  force?: boolean
}

export type DestroyAgentResult = {
  destroyed: boolean
  id: string
  name?: string
}

export type AgentManager = {
  listAgents: () => Promise<AgentSummary[]>
  readAgent: (agentId: string) => Promise<ReadAgentResult>
  createAgent: (requestedName: string) => Promise<AgentDetail>
  destroyAgent: (args: DestroyAgentArgs) => Promise<DestroyAgentResult>
}

type AgentManagerOptions = {
  computerId: string
  computerDir?: string
  imageRecordName?: string
  execApp?: string | null
  kickExecApp?: (computerId: string) => Promise<void>
}

const DEFAULT_IMAGE_RECORD = 'host-coder'

const isNotFound = (error: unknown) => error instanceof Deno.errors.NotFound

export function createAgentManager(options: AgentManagerOptions): AgentManager {
  const computerId = options.computerId
  const computerDir = options.computerDir ?? NFS_MOUNT_DIR
  const imageRecordName = options.imageRecordName ?? DEFAULT_IMAGE_RECORD
  const execApp = options.execApp ?? null

  const reconciler = createReconciler({ computerDir })
  const agentsDir = join(computerDir, computerId, COMPUTER_AGENTS)
  const execDir = join(computerDir, computerId, COMPUTER_EXEC)

  const kickExec = options.kickExecApp ?? (execApp
    ? async (id: string) => {
      const url = `http://${execApp}/changed/${id}`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        throw new Error(`Failed to notify exec app (${res.status})`)
      }
    }
    : async () => {})

  const ensureScaffolding = async () => {
    await ensureDir(agentsDir)
    await ensureDir(execDir)
  }

  const imageRecordPath = () =>
    join(
      computerDir,
      COMPUTER_AGENT_CONTAINERS,
      COMPUTER_REPOS,
      REPO_CONTAINER_IMAGES,
      `${imageRecordName}.json`,
    )

  const readRecord = async (): Promise<ImageRecord> => {
    return await readImageRecord(imageRecordPath())
  }

  const listAgentNames = async (): Promise<string[]> => {
    await ensureScaffolding()
    const names: string[] = []
    try {
      for await (const entry of Deno.readDir(agentsDir)) {
        if (entry.isDirectory) names.push(entry.name)
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    names.sort()
    return names
  }

  const agentExecPath = (agentId: string) => join(execDir, `${agentId}.json`)
  const agentDirPath = (agentId: string) => join(agentsDir, agentId)

  const readInstanceIfExists = async (
    agentId: string,
  ): Promise<ExecInstance | undefined> => {
    try {
      return await reconciler.readInstance(agentExecPath(agentId))
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  const writeInstance = async (agentId: string, instance: ExecInstance) => {
    await reconciler.writeInstance(agentExecPath(agentId), instance)
  }

  const deleteInstance = async (agentId: string) => {
    try {
      await reconciler.deleteInstance(agentExecPath(agentId))
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  const removeAgentDirectory = async (agentId: string) => {
    try {
      await Deno.remove(agentDirPath(agentId), { recursive: true })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  const toSummary = (
    agentId: string,
    instance?: ExecInstance,
  ): AgentDetail => {
    const machineId = instance?.machineId ?? `pending:${agentId}`
    const metadata = {
      software: instance?.software,
      hardware: instance?.hardware,
      machineId: instance?.machineId,
    }
    return {
      id: machineId,
      name: agentId,
      state: instance?.hardware ?? 'unknown',
      image: instance?.record.image,
      metadata,
      config: instance ? { record: instance.record } : undefined,
    }
  }

  const resolveAgentId = async (
    args: DestroyAgentArgs,
  ): Promise<{ agentId: string; instance?: ExecInstance } | undefined> => {
    if (args.name) {
      const instance = await readInstanceIfExists(args.name)
      return { agentId: args.name, instance }
    }
    if (args.id) {
      await ensureScaffolding()
      try {
        for await (const entry of Deno.readDir(execDir)) {
          if (entry.isFile && entry.name.endsWith('.json')) {
            const agentId = entry.name.replace(/\.json$/, '')
            const instance = await readInstanceIfExists(agentId)
            if (instance?.machineId === args.id) {
              return { agentId, instance }
            }
          }
        }
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
    return undefined
  }

  return {
    listAgents: async () => {
      const names = await listAgentNames()
      const summaries: AgentSummary[] = []
      for (const name of names) {
        const instance = await readInstanceIfExists(name)
        summaries.push(toSummary(name, instance))
      }
      return summaries
    },
    readAgent: async (agentId: string) => {
      const names = await listAgentNames()
      if (!names.includes(agentId)) {
        return { exists: false, reason: `Agent '${agentId}' not found.` }
      }
      const instance = await readInstanceIfExists(agentId)
      return { exists: true, agent: toSummary(agentId, instance) }
    },
    createAgent: async (requestedName: string) => {
      if (!requestedName || requestedName.trim().length === 0) {
        throw new Error('Agent name is required.')
      }
      const base = deriveBaseName(requestedName)
      const names = await listAgentNames()
      const nextIndex = nextIndexForName(names, base)
      const agentId = `${base}-${nextIndex}`
      if (!isValidFlyName(agentId)) {
        throw new Error(
          `Computed agent name '${agentId}' is invalid. Choose a shorter base name.`,
        )
      }

      await ensureScaffolding()
      await ensureDir(agentDirPath(agentId))
      await ensureDir(join(agentDirPath(agentId), AGENT_HOME))
      await ensureDir(join(agentDirPath(agentId), AGENT_WORKSPACE))
      await Deno.writeTextFile(join(agentDirPath(agentId), AGENT_TOML), '')

      const record = await readRecord()
      const instance: ExecInstance = {
        software: 'running',
        hardware: 'queued',
        record,
      }
      await writeInstance(agentId, instance)
      await kickExec(computerId)

      return toSummary(agentId, instance)
    },
    destroyAgent: async (args) => {
      if (!args.id && !args.name) {
        throw new Error('Provide agent id or name.')
      }
      const resolved = await resolveAgentId(args)
      if (!resolved) {
        throw new Error('Agent not found. Provide a valid name or machine id.')
      }
      const { agentId, instance } = resolved

      if (args.force) {
        await deleteInstance(agentId)
        await removeAgentDirectory(agentId)
        await kickExec(computerId)
        const machineId = instance?.machineId ?? `pending:${agentId}`
        return { destroyed: true, id: machineId, name: agentId }
      }

      if (!instance) {
        await deleteInstance(agentId)
        await removeAgentDirectory(agentId)
        return { destroyed: true, id: `pending:${agentId}`, name: agentId }
      }

      if (instance.hardware === 'queued') {
        await deleteInstance(agentId)
        await removeAgentDirectory(agentId)
      } else {
        instance.software = 'stopped'
        if (instance.hardware === 'starting') {
          instance.hardware = 'running'
        }
        await writeInstance(agentId, instance)
      }

      await kickExec(computerId)

      const machineId = instance.machineId ?? `pending:${agentId}`
      return { destroyed: true, id: machineId, name: agentId }
    },
  }
}

export function resolveRuntimeComputerId(): string {
  const value = Deno.env.get('MCP_AGENTS_COMPUTER_ID')
  if (value && value.trim()) return value.trim()
  return 'test-computer'
}

export function resolveRuntimeComputerDir(): string {
  const value = Deno.env.get('MCP_AGENTS_COMPUTER_DIR')
  if (value && value.trim()) return value.trim()
  return NFS_MOUNT_DIR
}

export function resolveRuntimeExecApp(): string | null {
  const override = Deno.env.get('MCP_AGENTS_EXEC_APP')
  if (override && override.trim()) return override.trim()
  try {
    return envs.DC_EXEC()
  } catch {
    return null
  }
}

export function resolveRuntimeImageRecord(): string {
  const value = Deno.env.get('MCP_AGENTS_IMAGE_RECORD')
  if (value && value.trim()) return value.trim()
  return DEFAULT_IMAGE_RECORD
}

export function shouldSkipMount(): boolean {
  return Deno.env.get('MCP_AGENTS_SKIP_NFS') === '1'
}

export function shouldSkipExecKick(): boolean {
  return Deno.env.get('MCP_AGENTS_NOOP_EXEC') === '1'
}
