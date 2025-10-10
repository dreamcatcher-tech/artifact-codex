import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  INTERACTION_TOOLS,
  type InteractionStatus,
  toStructured,
} from '@artifact/shared'
import { CodexAgent, createCodexAgent } from './codex.ts'
import type { CodexAgentOptions, CodexConfig } from './config.ts'
import { join } from '@std/path'
import { parse as parseToml } from '@std/toml'
import { VIEWS_RESOURCE_NAME, VIEWS_RESOURCE_URI } from '@artifact/shared'

export function registerAgent(server: McpServer) {
  const optionsPromise = resolveAgentOptions()
  let agent: CodexAgent | null = null
  let agentInitialized = false

  const getAgent = async (): Promise<CodexAgent> => {
    if (!agentInitialized) {
      const options = await optionsPromise
      agent = createCodexAgent(options)
      agentInitialized = true
    }
    if (!agent) {
      throw new Error('failed to initialize agent')
    }
    return agent
  }

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    async ({ agentId: _agentId, input }) => {
      const agent = await getAgent()
      const interactionId = await agent.startInteraction(String(input ?? ''))
      return toStructured({ interactionId })
    },
  )

  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    async ({ agentId: _agentId, interactionId }) => {
      const agent = await getAgent()
      const value = await agent.awaitInteraction(String(interactionId))
      return toStructured({ value })
    },
  )

  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    async ({ agentId: _agentId, interactionId }) => {
      const agent = await getAgent()
      const { cancelled, wasActive } = await agent.cancelInteraction(
        String(interactionId),
      )
      return toStructured({ cancelled, wasActive })
    },
  )

  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    async ({ agentId: _agentId, interactionId }) => {
      const agent = await getAgent()
      const state = agent.interactionStatus(
        String(interactionId),
      ) satisfies InteractionStatus['state']
      return toStructured({ state })
    },
  )

  server.registerResource(
    VIEWS_RESOURCE_NAME,
    VIEWS_RESOURCE_URI,
    {
      title: 'Agent Views',
      description: 'Lists current views exposed by agent-codex.',
      mimeType: 'application/json',
    },
    async (_) => {
      const agent = await getAgent()
      const views = agent.getViews()
      return {
        contents: [{
          uri: VIEWS_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify({ views }, null, 2),
        }],
      }
    },
  )

  addEventListener('unload', () => {
    if (!agentInitialized || !agent) return
    agent.destroy().catch(() => {
      // ignore shutdown errors
    })
  })
}

const resolveAgentOptions = (): Promise<CodexAgentOptions> => {
  const envOptions = resolveAgentOptionsFromEnv()
  if (envOptions) {
    return Promise.resolve(envOptions)
  }
  return resolveAgentOptionsFromFs()
}

function resolveAgentOptionsFromEnv(): CodexAgentOptions | undefined {
  const getEnv = (key: string): string | undefined => {
    try {
      return Deno.env.get(key) ?? undefined
    } catch {
      return undefined
    }
  }

  const workspace = trimOrUndefined(getEnv('CODEX_AGENT_WORKSPACE'))
  const home = trimOrUndefined(getEnv('CODEX_AGENT_HOME'))
  const launchEnv = trimOrUndefined(getEnv('CODEX_AGENT_LAUNCH'))
  const notifyDir = trimOrUndefined(getEnv('CODEX_AGENT_NOTIFY_DIR'))

  const cfg: CodexConfig = {}
  let hasConfig = false
  if (launchEnv === 'tmux' || launchEnv === 'disabled') {
    cfg.launch = launchEnv
    hasConfig = true
  }
  if (notifyDir) {
    cfg.notifyDir = notifyDir
    hasConfig = true
  }

  if (!workspace && !home && !hasConfig) {
    return undefined
  }

  const options: CodexAgentOptions = {}
  if (workspace) options.workspace = workspace
  if (home) options.home = home
  if (hasConfig) options.config = cfg
  return options
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function resolveAgentOptionsFromFs(): Promise<CodexAgentOptions> {
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
    if (error instanceof Deno.errors.NotFound) {
      return undefined
    }
    throw error
  }
}

async function readAgentConfig(path: string): Promise<CodexConfig | undefined> {
  try {
    const text = await Deno.readTextFile(path)
    if (text.trim().length === 0) return {}
    const parsed = parseToml(text)
    if (!parsed || typeof parsed !== 'object') return {}
    return toCodexConfig(parsed as Record<string, unknown>)
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

function toCodexConfig(raw: Record<string, unknown>): CodexConfig {
  const cfg: CodexConfig = {}
  if (typeof raw.launch === 'string') {
    const launch = raw.launch.trim()
    if (launch === 'tmux' || launch === 'disabled') {
      cfg.launch = launch
    }
  }
  if (typeof raw.notifyDir === 'string' && raw.notifyDir.trim().length > 0) {
    cfg.notifyDir = raw.notifyDir
  }
  return cfg
}
