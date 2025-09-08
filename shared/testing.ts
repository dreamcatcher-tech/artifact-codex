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
   * If true, forward child stderr to parent stderr (helpful for debugging).
   * Default: false.
   */
  passthroughStderr?: boolean
}

export type StdioMcpServer = {
  /** Child process pid if available (SDK client). */
  pid: number | null
  request: <T = unknown>(
    method: string,
    params?: unknown,
    id?: number | string,
  ) => Promise<T>
  close: () => void
  [Symbol.asyncDispose]: () => Promise<void>
}

/**
 * Spawn a stdio-based MCP server for tests and return a tiny JSON-RPC client.
 *
 * By default it runs: `deno run -c deno.json --allow-read --allow-write
 * --allow-env --allow-net main.ts` in the current working directory (each
 * `mcp-*` package tests run from their own folder).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ClientRequest as MCPClientRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import process from 'node:process'

function pidIsAlive(id: number): boolean {
  try {
    // Signal 0: probe for existence (no-op if alive; throws if dead)
    process.kill(id, 0)
    return true
  } catch {
    return false
  }
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

  // No additional stderr piping; 'inherit' avoids open resource tracking.

  async function request<T = unknown>(
    method: string,
    params?: unknown,
    _id?: number | string,
  ): Promise<T> {
    // Use a permissive schema to avoid per-method wiring in tests
    const Any = z.any()
    try {
      const req = (params === undefined)
        ? { method }
        : { method, params: params as Record<string, unknown> }
      // Cast to the SDK's ClientRequest type to satisfy typing
      const result = await client.request(req as MCPClientRequest, Any)
      return result as T
    } catch (err) {
      // Normalize error message to match previous tests expectations
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`${method} error: ${msg}`)
    }
  }

  async function close() {
    const { pid } = transport

    // Ask the transport to abort/close its child process.
    await transport.close()

    if (pid) {
      while (pidIsAlive(pid)) {
        await new Promise((r) => setTimeout(r))
      }
    }
  }

  return {
    pid: transport.pid,
    request,
    close,
    [Symbol.asyncDispose]: close,
  }
}
