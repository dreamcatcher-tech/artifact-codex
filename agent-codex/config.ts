import { dirname, fromFileUrl, join, normalize } from '@std/path'
import { exists } from '@std/fs'
import { type AgentOptions, envs } from '@artifact/shared'

const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
const TEMPLATE_PATH = join(MODULE_DIR, 'config.toml')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')

export async function prepareEnvironment(opts: AgentOptions) {
  const [workspace, home] = await assertDirs(opts.workspace, opts.home)
  await writeConfigTemplate(home)
  return { workspace, home }
}

async function writeConfigTemplate(home: string) {
  const template = await Deno.readTextFile(TEMPLATE_PATH)
  const rewritten = applyRewrites(template, home)
  const outPath = join(home, 'config.toml')
  await Deno.writeTextFile(outPath, rewritten)
}

function applyRewrites(template: string, home: string): string {
  const TEMPLATE_REWRITES = [
    {
      needle: '"__CODEX_NOTIFY__"',
      replace: () => {
        const notifyArgs = [
          Deno.execPath(),
          '-A',
          'run',
          NOTIFY_SCRIPT,
          '--dir',
          home,
        ]
        const serialized = notifyArgs
          .map((part) => JSON.stringify(part)).join(', ')
        return `[${serialized}]`
      },
    },
    {
      needle: '__OPENAI_PROXY_URL__',
      replace: () => envs.DC_OPENAI_PROXY_URL(),
    },
    {
      needle: '__MCP_LOCAL_URL__',
      replace: () => `http://localhost:${envs.DC_PORT()}/`,
    },
    {
      needle: '__MCP_BEARER_TOKEN_ENV_VAR__',
      replace: () => envs.DC_LOCAL_MCP_AUTH(),
    },
  ]
  return TEMPLATE_REWRITES.reduce((text, { needle, replace }) => {
    const split = text.split(needle)
    if (split.length !== 2) {
      throw new Error(`expected exactly one occurrence of ${needle}`)
    }
    return split.join(replace())
  }, template)
}

function assertDirs(...dirs: (string | undefined)[]): Promise<string[]> {
  return Promise.all(dirs.map(async (dir) => {
    if (!dir) {
      throw new Error('directory is required')
    }
    if (!(await exists(dir))) {
      throw new Error(`directory does not exist: ${dir}`)
    }
    const stat = await Deno.stat(dir)
    if (!stat.isDirectory) {
      throw new Error(`directory is not a directory: ${dir}`)
    }
    return normalize(dir)
  }))
}
