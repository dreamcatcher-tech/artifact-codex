import { dirname, fromFileUrl, join } from '@std/path'
import type { FaceOptions } from '@artifact/shared'

export type CodexConfig = { test?: boolean }
export type CodexFaceOptions = FaceOptions & { config?: CodexConfig }

const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
const REPO_ROOT = dirname(MODULE_DIR)
const TEMPLATE_PATH = join(MODULE_DIR, 'codex.config.toml')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')
const DREAMCATCHER_DIR = '.dreamcatcher'
const FACE_HOME_BUCKET = 'face-codex'

const TEMPLATE_REWRITES: Record<string, string> = {
  '/headers/mcp-computers/main.ts': join(REPO_ROOT, 'mcp-computers', 'main.ts'),
  '/headers/mcp-agents/main.ts': join(REPO_ROOT, 'mcp-agents', 'main.ts'),
  '/headers/mcp-faces/main.ts': join(REPO_ROOT, 'mcp-faces', 'main.ts'),
  '/headers/mcp-interactions/main.ts': join(
    REPO_ROOT,
    'mcp-interactions',
    'main.ts',
  ),
}

export type LaunchPreparation = {
  workspace: string
  home: string
}

export async function prepareLaunchDirectories(
  opts: CodexFaceOptions,
): Promise<LaunchPreparation | undefined> {
  const workspace = opts.workspace
  if (!workspace) return undefined

  await requireDirectory(workspace, 'workspace')
  const envHome = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE')
  const home = resolveHomePath(opts.home, envHome)
  await ensureHomeDirectory(home)
  await writeConfigTemplate(home)
  return { workspace, home }
}

function resolveHomePath(
  provided: string | undefined,
  envHome: string | undefined,
): string {
  if (!provided || provided === '') {
    if (!envHome) {
      throw new Error('home directory not provided and HOME is unset')
    }
    return join(
      envHome,
      DREAMCATCHER_DIR,
      FACE_HOME_BUCKET,
      crypto.randomUUID(),
    )
  }

  if (provided === '~') {
    if (!envHome) {
      throw new Error('~ cannot be resolved because HOME is unset')
    }
    return envHome
  }

  if (provided.startsWith('~/')) {
    if (!envHome) {
      throw new Error('~/ paths require HOME to be set')
    }
    return join(envHome, provided.slice(2))
  }

  return provided
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
    text = text.split(needle).join(replacement)
  }
  return text
}

function ensureNotifyBlock(template: string, configDir: string): string {
  if (/\nnotify\s*=/.test(template)) return template
  const notifyArgs = [
    'deno',
    'run',
    `--allow-write=${configDir}`,
    NOTIFY_SCRIPT,
    '--dir',
    configDir,
  ]
  const serialized = notifyArgs.map((part) => JSON.stringify(part)).join(', ')
  return `${template}\nnotify = [${serialized}]\n`
}
