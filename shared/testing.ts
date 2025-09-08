export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

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
  child: Deno.ChildProcess
  request: <T = unknown>(
    method: string,
    params?: unknown,
    id?: number | string,
  ) => Promise<T>
  close: () => Promise<void>
  [Symbol.asyncDispose]: () => Promise<void>
}

/**
 * Spawn a stdio-based MCP server for tests and return a tiny JSON-RPC client.
 *
 * By default it runs: `deno run -c deno.json --allow-read --allow-write
 * --allow-env --allow-net main.ts` in the current working directory (each
 * `mcp-*` package tests run from their own folder).
 */
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

  const command = new Deno.Command(cmd, {
    args,
    env: opts.env,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  })

  const child = command.spawn()
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  const outReader = child.stdout.getReader()
  const errReader = child.stderr.getReader()

  let outBuf = ''
  const pending: Map<number | string, (r: JsonRpcResponse) => void> = new Map() // Drain stderr (optionally print for debugging)
  ;(async () => {
    try {
      while (true) {
        const { value, done } = await errReader.read()
        if (done) break
        if (opts.passthroughStderr && value) {
          // best-effort forwarding (avoid throwing if closed)
          try {
            Deno.stderr.writeSync(value)
          } catch (_) {
            // ignore
          }
        }
      }
    } catch (_) {
      // ignore
    }
  })() // Read newline-delimited JSON from stdout
  ;(async () => {
    try {
      while (true) {
        const { value, done } = await outReader.read()
        if (done) break
        if (!value) continue
        outBuf += dec.decode(value)
        let idx: number
        while ((idx = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, idx).trim()
          outBuf = outBuf.slice(idx + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line) as JsonRpcResponse
            if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
              const resolver = pending.get(msg.id ?? '')
              if (resolver) {
                pending.delete(msg.id ?? '')
                resolver(msg)
              }
            }
          } catch (_) {
            // ignore non-JSON lines
          }
        }
      }
    } catch (_) {
      // ignore
    }
  })()

  // Keep function async
  await Promise.resolve()

  async function request<T = unknown>(
    method: string,
    params?: unknown,
    id: number | string = crypto.randomUUID(),
  ): Promise<T> {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    const promise = new Promise<JsonRpcResponse>((resolve) => {
      pending.set(id, resolve)
    })
    const writer = child.stdin.getWriter()
    try {
      await writer.write(enc.encode(JSON.stringify(req) + '\n'))
    } finally {
      writer.releaseLock()
    }
    const res = await promise
    if (res.error) {
      throw new Error(`${method} error ${res.error.code}: ${res.error.message}`)
    }
    return res.result as T
  }

  async function close() {
    // Try to terminate cleanly; swallow errors from races
    try {
      child.kill('SIGTERM')
    } catch (_) {
      // ignore
    }
    try {
      await child.status
    } catch (_) {
      // ignore
    }
    try {
      outReader.releaseLock()
    } catch (_) {
      // ignore
    }
    try {
      errReader.releaseLock()
    } catch (_) {
      // ignore
    }
    try {
      child.stdin.close()
    } catch (_) {
      // ignore
    }
  }

  return { child, request, close, [Symbol.asyncDispose]: close }
}
