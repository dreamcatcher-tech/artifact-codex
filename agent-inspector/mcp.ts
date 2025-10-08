import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  type AgentOptions,
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  launchTmuxTerminal,
  toStructured,
} from '@artifact/shared'
import type { InteractionStatus } from '@artifact/shared'
import { join } from '@std/path'
import { parse as parseToml } from '@std/toml'

const DEFAULT_TTYD_PORT = 10000
const VIEWS_RESOURCE_NAME = 'views'
const VIEWS_RESOURCE_URI = 'mcp://views'

type InspectorConfig = {
  test: boolean
  ttydPort: number
  uiPort: number
  apiPort: number
}

type InspectorAgentOptions = AgentOptions & {
  config?: Record<string, unknown>
}

type InteractionRecord = {
  state: InteractionStatus['state']
  promise: Promise<string>
  result?: string
  error?: Error
}

export function registerAgent(server: McpServer) {
  const optionsPromise = resolveAgentOptions()

  let cachedOptions: InspectorAgentOptions | undefined
  const getOptions = async () => {
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

    launchPromise = (async () => {
      const opts = await getOptions()
      const workspace = opts.workspace
      const home = opts.home
      const config = resolveInspectorConfig(opts.config)

      if (!workspace || !home) {
        throw new Error('agent-inspector requires workspace and home options')
      }

      await assertDirectory(workspace, 'workspace')
      await ensureDirectory(home)

      if (config.test) {
        views = [
          {
            name: 'terminal',
            port: config.ttydPort,
            protocol: 'http',
            url: `https://${HOST}:${config.ttydPort}`,
          },
          {
            name: 'client',
            port: config.uiPort,
            protocol: 'http',
            url: `https://${HOST}:${config.uiPort}`,
          },
        ]
        return
      }

      const env: Record<string, string> = {
        ...readEnvSafe(),
        HOST,
        ALLOWED_ORIGINS: '*',
        MCP_AUTO_OPEN_ENABLED: 'false',
        PORT: String(config.uiPort),
        CLIENT_PORT: String(config.uiPort),
        SERVER_PORT: String(config.apiPort),
        MCP_PROXY_FULL_ADDRESS: `http://${HOST}:${config.apiPort}`,
      }

      tmuxSession = `agent-inspector-${crypto.randomUUID().slice(0, 8)}`
      env.SESSION = tmuxSession
      env.TTYD_PORT = String(config.ttydPort)
      env.TTYD_HOST = HOST

      const launch = await launchTmuxTerminal({
        command: ['npx', '-y', '@modelcontextprotocol/inspector'],
        session: tmuxSession,
        ttydPort: config.ttydPort,
        ttydHost: HOST,
        cwd: workspace,
        env,
      })

      child = launch.child
      views = [
        {
          name: 'terminal',
          port: config.ttydPort,
          protocol: 'http',
          url: `http://${HOST}:${config.ttydPort}`,
        },
        {
          name: 'client',
          port: config.uiPort,
          protocol: 'http',
          url: `http://${HOST}:${config.uiPort}`,
        },
      ]
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
    if (!proc) return
    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore termination issues
    }
    try {
      await proc.status
    } catch {
      // ignore awaiting status failures
    }
  }

  const resolveInteraction = (
    id: string,
  ): InteractionRecord | undefined => interactions.get(id)

  const startInteraction = (
    _input: string,
  ): { interactionId: string; record: InteractionRecord } => {
    const interactionId = String(interactionSeq++)
    const record: InteractionRecord = {
      state: 'pending',
      promise: Promise.resolve(''),
    }

    const promise = (async () => {
      try {
        await ensureLaunch()
        if (resolveInteraction(interactionId)?.state === 'cancelled') {
          throw new Error(`interaction cancelled: ${interactionId}`)
        }
        await waitForCancelWindow()
        if (resolveInteraction(interactionId)?.state === 'cancelled') {
          throw new Error(`interaction cancelled: ${interactionId}`)
        }
        record.state = 'completed'
        record.result = 'ready'
        return record.result
      } catch (error) {
        if (record.state !== 'cancelled') {
          record.state = 'completed'
        }
        const err = error instanceof Error ? error : new Error(String(error))
        record.error = err
        throw err
      }
    })()
    promise.catch(() => {
      // Avoid unhandled rejection noise; actual error surfaced via record.error
    })
    record.promise = promise

    interactions.set(interactionId, record)
    return { interactionId, record }
  }

  const awaitInteraction = async (
    interactionId: string,
  ): Promise<CallToolResult> => {
    const record = resolveInteraction(interactionId)
    if (!record) throw new Error(`unknown interaction id: ${interactionId}`)
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
      description: 'Lists the active views exposed by agent-inspector.',
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
      // ignore shutdown errors
    })
  })

  ensureLaunch().catch((error) => {
    console.error('failed to launch agent-inspector:', error)
  })
}

function resolveAgentOptions(): Promise<InspectorAgentOptions> {
  const envOptions = resolveAgentOptionsFromEnv()
  if (envOptions) {
    return Promise.resolve(envOptions)
  }
  return resolveAgentOptionsFromFs()
}

function resolveAgentOptionsFromEnv(): InspectorAgentOptions | undefined {
  const getEnv = (name: string): string | undefined => {
    try {
      return Deno.env.get(name) ?? undefined
    } catch {
      return undefined
    }
  }

  const workspace = trimOrUndefined(getEnv('AGENT_INSPECTOR_WORKSPACE'))
  const home = trimOrUndefined(getEnv('AGENT_INSPECTOR_HOME'))
  const configValue = trimOrUndefined(getEnv('AGENT_INSPECTOR_CONFIG'))
  const config = configValue ? parseEnvConfig(configValue) : undefined

  if (!workspace && !home && !config) {
    return undefined
  }

  const options: InspectorAgentOptions = {}
  if (workspace) options.workspace = workspace
  if (home) options.home = home
  if (config) options.config = config
  return options
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseEnvConfig(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore parse failures; caller will treat as undefined
  }
  return undefined
}

async function resolveAgentOptionsFromFs(): Promise<InspectorAgentOptions> {
  const cwd = Deno.cwd()
  const [workspace, home, config] = await Promise.all([
    resolveDirectory(join(cwd, AGENT_WORKSPACE)),
    prepareHomeDirectory(join(cwd, AGENT_HOME)),
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

async function prepareHomeDirectory(path: string): Promise<string | undefined> {
  try {
    await Deno.mkdir(path, { recursive: true })
    return path
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

function resolveInspectorConfig(
  raw: Record<string, unknown> | undefined,
): InspectorConfig {
  const config: InspectorConfig = {
    test: false,
    ttydPort: DEFAULT_TTYD_PORT,
    uiPort: DEFAULT_TTYD_PORT + 1,
    apiPort: DEFAULT_TTYD_PORT + 2,
  }
  if (!raw) return config

  const testValue = raw.test
  if (typeof testValue === 'boolean') {
    config.test = testValue
  } else if (typeof testValue === 'string') {
    config.test = parseBoolean(testValue)
  }

  const ttydPort = extractPort(raw.ttydPort)
  if (typeof ttydPort === 'number') {
    config.ttydPort = ttydPort
  }

  const uiPort = extractPort(raw.uiPort)
  if (typeof uiPort === 'number') {
    config.uiPort = uiPort
  } else if (typeof ttydPort === 'number') {
    config.uiPort = config.ttydPort + 1
  }

  const apiPort = extractPort(raw.apiPort)
  if (typeof apiPort === 'number') {
    config.apiPort = apiPort
  } else if (typeof ttydPort === 'number') {
    config.apiPort = config.ttydPort + 2
  }

  return config
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

function parseBoolean(value: string): boolean {
  const truthy = new Set(['1', 'true', 'on', 'yes'])
  return truthy.has(value.trim().toLowerCase())
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

async function ensureDirectory(path: string) {
  try {
    await Deno.mkdir(path, { recursive: true })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`unable to create directory: ${path}`)
    }
    if (error instanceof Deno.errors.AlreadyExists) {
      return
    }
    throw error
  }
}

function readEnvSafe(): Record<string, string> {
  try {
    return Deno.env.toObject()
  } catch {
    return {}
  }
}

async function waitForCancelWindow() {
  await new Promise((resolve) => setTimeout(resolve))
}
