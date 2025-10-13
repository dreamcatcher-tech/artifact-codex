import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { waitForPidExit } from './mcp.ts'
import { join } from '@std/path'

export type SpawnOptions = {
  /**
   * Command to run. Defaults to `deno`.
   */
  cmd?: string
  /**
   * Arguments for the command. Defaults to running the local package's
   * `main.ts` with standard permissions used by our MCP servers.
   */
  args?: string[]
  /**
   * Environment overrides to pass to the child process.
   */
  env?: Record<string, string>
  /**
   * Optional disposer invoked when the spawned server is torn down.
   */
  dispose?: () => void | Promise<void>
}

export type StdioMcpServer = {
  /** Child process pid if available (SDK client). */
  pid: number | null
  client: Client
  close: () => void
  [Symbol.asyncDispose]: () => Promise<void>
}

export async function spawnStdioMcpServer(
  opts: SpawnOptions = {},
): Promise<StdioMcpServer> {
  const cmd = opts.cmd ?? 'deno'
  const args = opts.args ?? [
    'run',
    '-c',
    'deno.json',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    'main.ts',
  ]

  const transport = new StdioClientTransport({
    command: cmd,
    args,
    env: opts.env,
    cwd: Deno.cwd(),
  })

  const client = new Client({ name: 'test-client', version: '0.1.0' })
  await client.connect(transport)

  let disposed = false
  async function close() {
    if (disposed) return
    disposed = true
    const { pid } = transport
    await client.close()
    await waitForPidExit(pid)
    if (opts.dispose) {
      try {
        await opts.dispose()
      } catch {
        // swallow disposer errors to keep shutdown resilient
      }
    }
  }

  return {
    pid: transport.pid,
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

export async function createTempHostFs(prefix?: string) {
  const tempRoot = await Deno.makeTempDir({ prefix })
  const workspaceDir = join(tempRoot, 'workspace')
  const homeDir = join(tempRoot, 'home')
  const notifyDir = join(tempRoot, 'notify')
  await Promise.all([
    Deno.mkdir(workspaceDir, { recursive: true }),
    Deno.mkdir(homeDir, { recursive: true }),
    Deno.mkdir(notifyDir, { recursive: true }),
  ])

  return {
    workspaceDir,
    homeDir,
    notifyDir,
    [Symbol.asyncDispose]: async () => {
      await cleanupTempDir(tempRoot)
    },
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
