import { join } from '@std/path'
import {
  AGENT_HOME,
  AGENT_WORKSPACE,
  type AgentClient,
  startAgentClient,
} from './mod.ts'

export type SpawnOptions = {
  /**
   * Environment overrides to pass to the child process.
   */
  env?: Record<string, string>
}

export type StdioTestClient = {
  client: AgentClient
  close: () => void
  [Symbol.asyncDispose]: () => Promise<void>
}

export async function startTestStdioClient(
  opts: { env?: Record<string, string | number | boolean> } = {},
): Promise<StdioTestClient> {
  const command = 'deno'
  const args = ['run', '-c', 'deno.json', '-A', 'main.ts']
  const fs = await createAgentFs()
  const env = { ...opts.env, DC_AGENTS_DIR: fs.agentDir }

  const client = await startAgentClient({ command, args, env, cwd: Deno.cwd() })
  async function close() {
    await client.close()
    await fs.dispose()
  }

  return {
    client,
    close,
    [Symbol.asyncDispose]: close,
  }
}

type TextContent = {
  text: string
  mimeType?: string
}

export function isTextContent(content: unknown): content is TextContent {
  return Boolean(
    content && typeof content === 'object' &&
      typeof (content as { text?: unknown }).text === 'string',
  )
}

export async function createAgentFs(prefix?: string) {
  const agentDir = await Deno.makeTempDir({ prefix })
  const workspaceDir = join(agentDir, AGENT_WORKSPACE)
  const homeDir = join(agentDir, AGENT_HOME)
  await Promise.all([
    Deno.mkdir(workspaceDir, { recursive: true }),
    Deno.mkdir(homeDir, { recursive: true }),
  ])

  const dispose = async () => {
    await cleanupTempDir(agentDir)
  }

  return {
    agentDir,
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
}

export async function cleanupTempDir(path: string) {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Failed to clean up temp dir ${path}: ${message}`)
  }
}
