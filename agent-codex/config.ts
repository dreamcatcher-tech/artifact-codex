import { dirname, fromFileUrl, join, resolve } from '@std/path'
import { type AgentOptions, type AgentView, envs } from '@artifact/shared'
import { envs as codexEnvs } from './env.ts'

export type CodexConfig = {
  env?: Record<string, string>
  getEnv?: (key: string) => string | undefined
  launch?: 'tmux' | 'disabled'
  notifyDir?: string
}
export type CodexLaunchArgs = {
  configDir: string
  workspace: string
  host: string
  tmuxSession: string
}

export type CodexLaunchResult = {
  child?: Deno.ChildProcess
  pid?: number
  views: AgentView[]
}

export type CodexOverrides = {
  sendKeys?: (session: string, input: string) => void
  sendCancel?: (session: string) => void
  launchProcess?: (args: CodexLaunchArgs) => Promise<CodexLaunchResult>
}

export type CodexAgentOptions = AgentOptions & {
  config?: CodexConfig
  overrides?: CodexOverrides
}

const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
const REPO_ROOT = dirname(MODULE_DIR)
const TEMPLATE_PATH = join(MODULE_DIR, 'codex.config.toml')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')
const NOTIFY_MARKER_LINE = 'notify = "__CODEX_NOTIFY__"'
const DREAMCATCHER_DIR = '.dreamcatcher'
const AGENT_HOME_BUCKET = 'agent-codex'

const TEMPLATE_REWRITES: Record<string, string> = {
  '__MCP_COMPUTERS_COMMAND__': join(
    REPO_ROOT,
    'mcp-computers',
    'main.ts',
  ),
  '__OPENAI_PROXY_BASE_URL__': envs.DC_OPENAI_PROXY_BASE_URL(),
}

export type LaunchPreparation = {
  workspace: string
  home: string
}

export async function prepareEnvironment(
  opts: CodexAgentOptions,
): Promise<LaunchPreparation | undefined> {
  const workspace = opts.workspace
  if (!workspace) return undefined

  await requireDirectory(workspace, 'workspace')
  const home = resolveHomePath(opts.home, workspace)
  await ensureHomeDirectory(home)
  await writeAuthFile(home, opts.config)
  await writeConfigTemplate(home)
  return { workspace, home }
}

function resolveHomePath(
  provided: string | undefined,
  workspace: string,
): string {
  if (!provided || provided === '') {
    return join(
      workspace,
      DREAMCATCHER_DIR,
      AGENT_HOME_BUCKET,
      crypto.randomUUID(),
    )
  }

  if (provided.startsWith('~')) {
    throw new Error('home paths under ~ are not permitted')
  }

  return resolve(workspace, provided)
}

async function ensureHomeDirectory(path: string) {
  try {
    const st = await Deno.stat(path)
    if (!st.isDirectory) {
      throw new Error(`home is not a directory: ${path}`)
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      await Deno.mkdir(path, { recursive: true })
      return
    }
    throw err
  }
}

async function requireDirectory(path: string, label: string) {
  try {
    const st = await Deno.stat(path)
    if (!st.isDirectory) {
      throw new Error(`${label} is not a directory: ${path}`)
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(`${label} directory not found: ${path}`)
    }
    throw err
  }
}

async function writeConfigTemplate(configDir: string) {
  let template = await Deno.readTextFile(TEMPLATE_PATH)
  template = applyRewrites(template)
  template = ensureNotifyBlock(template, configDir)
  const outPath = join(configDir, 'config.toml')
  await Deno.writeTextFile(outPath, template)
}

function applyRewrites(template: string): string {
  let text = template
  for (const [needle, replacement] of Object.entries(TEMPLATE_REWRITES)) {
    const split = text.split(needle)
    if (split.length !== 2) {
      throw new Error(`split.length !== 2: ${needle} -> ${replacement}`)
    }
    text = split.join(replacement)
  }
  return text
}

function ensureNotifyBlock(template: string, configDir: string): string {
  const notifyArgs = [NOTIFY_SCRIPT, '--dir', configDir]
  const serialized = notifyArgs.map((part) => JSON.stringify(part)).join(', ')
  const line = `notify = [${serialized}]`
  if (!template.includes(NOTIFY_MARKER_LINE)) {
    throw new Error('notify block not found in template')
  }
  const replaced = template.replace(NOTIFY_MARKER_LINE, line)
  return replaced
}

async function writeAuthFile(configDir: string, cfg?: CodexConfig) {
  const OPENAI_API_KEY = resolveOpenAiKey(cfg)
  const payload = JSON.stringify({ OPENAI_API_KEY }, null, 2)
  const outPath = join(configDir, 'auth.json')
  await Deno.writeTextFile(outPath, `${payload}\n`)
}

function resolveOpenAiKey(cfg?: CodexConfig): string {
  const direct = cfg?.env?.OPENAI_API_KEY
  if (typeof direct === 'string') {
    const trimmed = direct.trim()
    if (trimmed.length > 0) return trimmed
  }
  const fromGetter = cfg?.getEnv?.('OPENAI_API_KEY')
  if (typeof fromGetter === 'string') {
    const trimmed = fromGetter.trim()
    if (trimmed.length > 0) return trimmed
  }
  return codexEnvs.OPENAI_API_KEY()
}
