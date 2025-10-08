import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  HOST,
  INTERACTION_TOOLS,
  type InteractionStatus,
  launchTmuxTerminal,
  parseWritable,
  sendKeysViaTmux,
  toStructured,
} from '@artifact/shared'
import type { AgentOptions, AgentView } from '@artifact/shared'
import { join } from '@std/path'
import { parse as parseToml } from '@std/toml'

const DEFAULT_TTYD_PORT = 10000
const VIEWS_RESOURCE_NAME = 'views'
const VIEWS_RESOURCE_URI = 'mcp://views'

type CmdConfig = {
  command: string[]
  title?: string
  ttydPort?: number
  writeable: boolean
}

type InteractionRecord = {
  state: InteractionStatus
  promise: Promise<string>
  result?: string
  error?: Error
}

export function registerAgent(server: McpServer) {
  const globalOptions = (globalThis as { options?: AgentOptions }).options
  const optionsPromise: Promise<AgentOptions> = globalOptions
    ? Promise.resolve(globalOptions)
    : resolveAgentOptionsFromFs()
  let cachedOptions: AgentOptions | undefined

  const getOptions = async (): Promise<AgentOptions> => {
    if (!cachedOptions) {
      cachedOptions = await optionsPromise
    }
    return cachedOptions
  }

  let tmuxSession: string | undefined
  let child: Deno.ChildProcess | undefined
  let views: AgentView[] = []
  let launchPromise: Promise<void> | null = null
  let launchError: Error | null = null

  const interactions = new Map<string, InteractionRecord>()
  let interactionSeq = 0

  const ensureLaunch = async () => {
    if (launchError) throw launchError
    if (launchPromise) {
      await launchPromise
      return
    }

    const opts = await getOptions()
    const workspace = opts.workspace
    if (!workspace) return

    launchPromise = (async () => {
      await assertDirectory(workspace, 'workspace')
      const cfg = resolveCmdConfig(opts.config)
      tmuxSession = `agent-cmd-${crypto.randomUUID().slice(0, 8)}`
      const ttydPort = cfg.ttydPort ?? DEFAULT_TTYD_PORT
      const ttydHost = HOST

      const env: Record<string, string> = {
        ...readEnvSafe(),
        SESSION: tmuxSession,
        TTYD_PORT: String(ttydPort),
        HOST: HOST,
        TTYD_HOST: ttydHost,
        WRITEABLE: cfg.writeable ? 'on' : 'off',
      }

      const launch = await launchTmuxTerminal({
        command: [...cfg.command],
        session: tmuxSession,
        ttydPort,
        ttydHost,
        cwd: workspace,
        env,
        writeable: cfg.writeable,
      })
      child = launch.child
      views = [{
        name: cfg.title ?? 'terminal',
        port: ttydPort,
        protocol: 'http',
        url: `http://${ttydHost}:${ttydPort}`,
      }]
    })().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      launchError = err
      throw err
    }).finally(() => {
      if (launchError) {
        launchPromise = null
      }
    })

    await launchPromise
  }

  const destroy = async () => {
    const proc = child
    child = undefined
    views = []
    if (proc) {
      try {
        proc.kill('SIGTERM')
      } catch {
        // ignore
      }
      try {
        await proc.status
      } catch {
        // ignore
      }
    }
  }

  const resolveInteraction = (
    id: string,
  ): InteractionRecord | undefined => interactions.get(id)

  const startInteraction = (
    input: string,
  ): { interactionId: string; result: InteractionRecord } => {
    const interactionId = String(interactionSeq++)
    const record: InteractionRecord = {
      state: 'pending',
      promise: Promise.resolve(''),
    }
    record.promise = (async () => {
      try {
        await ensureLaunch()
        if (record.state === 'cancelled') {
          throw new Error(`interaction cancelled: ${interactionId}`)
        }
        if (tmuxSession) {
          await sendKeysViaTmux(tmuxSession, String(input))
        }
        record.state = 'completed'
        record.result = 'ok'
        return 'ok'
      } catch (error) {
        record.state = 'completed'
        const err = error instanceof Error ? error : new Error(String(error))
        record.error = err
        throw err
      }
    })()
    interactions.set(interactionId, record)
    return { interactionId, result: record }
  }

  const awaitInteraction = async (
    interactionId: string,
  ): Promise<CallToolResult> => {
    const record = resolveInteraction(interactionId)
    if (!record) {
      throw new Error(`unknown interaction id: ${interactionId}`)
    }
    if (record.state === 'cancelled') {
      interactions.delete(interactionId)
      throw record.error ?? new Error(`interaction cancelled: ${interactionId}`)
    }
    try {
      const value = await record.promise
      interactions.delete(interactionId)
      return toStructured({ value })
    } catch (error) {
      interactions.delete(interactionId)
      throw error
    }
  }

  const cancelInteraction = (interactionId: string): CallToolResult => {
    const record = resolveInteraction(interactionId)
    if (!record) {
      return toStructured({ cancelled: false, wasActive: false })
    }
    record.state = 'cancelled'
    if (!record.error) {
      record.error = new Error(`interaction cancelled: ${interactionId}`)
    }
    interactions.set(interactionId, record)
    return toStructured({ cancelled: true, wasActive: true })
  }

  const statusInteraction = (interactionId: string): CallToolResult => {
    const record = resolveInteraction(interactionId)
    const state = record?.state ?? 'pending'
    return toStructured({ state })
  }

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    ({ agentId: _agentId, input }) => {
      const { interactionId } = startInteraction(input)
      return toStructured({ interactionId })
    },
  )

  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    ({ agentId: _agentId, interactionId }) => awaitInteraction(interactionId),
  )

  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    ({ agentId: _agentId, interactionId }) => cancelInteraction(interactionId),
  )

  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    ({ agentId: _agentId, interactionId }) => statusInteraction(interactionId),
  )

  server.registerResource(
    VIEWS_RESOURCE_NAME,
    VIEWS_RESOURCE_URI,
    {
      title: 'Agent Views',
      description: 'Lists the active views exposed by agent-cmd.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      await ensureLaunch()
      const payload = { views }
      return {
        contents: [{
          uri: VIEWS_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
        }],
      }
    },
  )

  addEventListener('unload', () => {
    destroy().catch(() => {
      // ignore
    })
  })
}

async function resolveAgentOptionsFromFs(): Promise<AgentOptions> {
  const cwd = Deno.cwd()
  const [workspace, home, config] = await Promise.all([
    resolveDirectory(join(cwd, AGENT_WORKSPACE)),
    resolveDirectory(join(cwd, AGENT_HOME)),
    readAgentConfig(join(cwd, AGENT_TOML)),
  ])
  return {
    workspace,
    home,
    config,
  }
}

async function resolveDirectory(path: string): Promise<string | undefined> {
  try {
    const stat = await Deno.stat(path)
    return stat.isDirectory ? path : undefined
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

async function readAgentConfig(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await Deno.readTextFile(path)
    if (text.trim().length === 0) return {}
    const parsed = parseToml(text)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined
    }
    throw new Error(
      `failed to read agent config (${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function assertDirectory(path: string, label: string) {
  try {
    const stat = await Deno.stat(path)
    if (!stat.isDirectory) {
      throw new Error(`${label} is not a directory: ${path}`)
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${label} directory not found: ${path}`)
    }
    throw error
  }
}

function resolveCmdConfig(
  raw: Record<string, unknown> | undefined,
): CmdConfig {
  if (!raw) {
    throw new Error('config.command must be a non-empty string[]')
  }
  const command = extractCommand(raw.command)
  if (!command) {
    throw new Error('config.command must be a non-empty string[]')
  }
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0
    ? raw.title.trim()
    : undefined
  const ttydPort = extractPort(raw.ttydPort)
  const writeable = extractWritable(raw.writeable)
  return { command, title, ttydPort, writeable }
}

function extractCommand(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const command = value.every((item) => typeof item === 'string')
    ? value as string[]
    : undefined
  if (!command || command.length === 0) return undefined
  return command
}

function extractPort(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

function extractWritable(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return parseWritable(value)
  }
  return true
}

function readEnvSafe(): Record<string, string> {
  try {
    return Deno.env.toObject()
  } catch {
    return {}
  }
}
