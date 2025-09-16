import { dirname, fromFileUrl, join, resolve } from '@std/path'
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
  const home = resolveHomePath(opts.home, workspace)
  await ensureHomeDirectory(home)
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
      FACE_HOME_BUCKET,
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
    text = text.split(needle).join(replacement)
  }
  return text
}

function ensureNotifyBlock(template: string, configDir: string): string {
  const notifyArgs = [
    'deno',
    'run',
    `--allow-write=${configDir}`,
    NOTIFY_SCRIPT,
    '--dir',
    configDir,
  ]
  const serialized = notifyArgs.map((part) => JSON.stringify(part)).join(', ')
  const block = `\nnotify = [${serialized}]\n`
  const pattern = /\nnotify\s*=\s*\[[\s\S]*?\](?:\n|$)/
  if (pattern.test(template)) {
    return template.replace(pattern, block)
  }
  const prefix = template.endsWith('\n') ? template.slice(0, -1) : template
  return `${prefix}${block}`
}
