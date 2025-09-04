import { expect } from '@std/expect'
// Fly unit tests now live in mcp-shared (see mcp-shared/fly.test.ts)

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

async function spawnServer() {
  const cmd = new Deno.Command('deno', {
    args: [
      'run',
      '-c',
      'deno.json',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-net',
      'main.ts',
    ],
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  })

  const child = cmd.spawn()
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  // Stream readers
  const outReader = child.stdout.getReader()
  const errReader = child.stderr.getReader()

  let outBuf = ''
  const pending: Map<number | string, (r: JsonRpcResponse) => void> = new Map() // Drain stderr for easier debugging if something goes wrong
  ;(async () => {
    try {
      while (true) {
        const { value: _value, done } = await errReader.read()
        if (done) break
        // Uncomment to debug locally:
        // console.error(dec.decode(value));
      }
    } catch (_) {
      // ignore
    }
  })() // Basic line-delimited JSON-RPC reader
  ;(async () => {
    try {
      while (true) {
        const { value, done } = await outReader.read()
        if (done) break
        outBuf += dec.decode(value)
        let idx: number
        while ((idx = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, idx).trim()
          outBuf = outBuf.slice(idx + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line) as JsonRpcResponse
            if (msg && Object.prototype.hasOwnProperty.call(msg, 'id')) {
              const resolver = pending.get(msg.id ?? '')
              if (resolver) {
                pending.delete(msg.id ?? '')
                resolver(msg)
              }
            }
          } catch (_) {
            // Ignore non-JSON lines (e.g., logs if any make it to stdout)
          }
        }
      }
    } catch (_) {
      // ignore
    }
  })()

  // Keep function async for call sites; satisfy require-await rule.
  await Promise.resolve()

  async function request<T = unknown>(
    method: string,
    params?: unknown,
    id: number | string = crypto.randomUUID(),
  ) {
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
    withSafety(() => child.kill('SIGTERM'))
    await child.status
    withSafety(() => outReader.releaseLock())
    withSafety(() => errReader.releaseLock())
    withSafety(() => child.stdin.close())
  }

  return { child, request, close, [Symbol.asyncDispose]: close } as const
}

const withSafety = (fn: () => unknown) => {
  try {
    return fn()
  } catch {
    // ignore
  }
}

Deno.test(
  {
    name: 'MCP initialize handshake',
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async (_t) => {
    const srv = await spawnServer()
    try {
      type InitializeResult = {
        serverInfo?: { name?: string; version?: string }
        protocolVersion?: string
      }
      const result = await srv.request<InitializeResult>('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      }, 1)

      expect(result).toBeDefined()
      expect(typeof result.serverInfo?.name).toBe('string')
      expect(result.serverInfo?.name).toBe('fly-mcp')
      expect(typeof result.protocolVersion).toBe('string')
    } finally {
      await srv.close()
    }
  },
)

Deno.test({
  name: 'tools/list includes only agent tools',
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const srv = await spawnServer()
  try {
    await srv.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.1.0' },
    }, 1)

    type ToolsListResult = { tools?: { name: string }[] }
    const list = await srv.request<ToolsListResult>('tools/list', {}, 2)
    const names = (list.tools ?? []).map((t) => t.name)
    expect(names).toContain('list_agents')
    expect(names).toContain('create_agent')
    expect(names).toContain('destroy_agent')
    expect(names).not.toContain('create_computer')
    expect(names).not.toContain('list_computers')
    expect(names).not.toContain('computer_exists')
  } finally {
    await srv.close()
  }
})

// (moved unit tests that previously targeted fly.ts)

// Removed echo/add tools and their tests.

Deno.test({
  name: 'create_agent rejects invalid names before env checks',
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const srv = await spawnServer()
  try {
    await srv.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.1.0' },
    }, 1)
    type ToolsCallTextResult = { content?: { type: string; text?: string }[] }
    const res = await srv.request<ToolsCallTextResult>('tools/call', {
      name: 'create_agent',
      arguments: { name: 'Bad_Name' },
    }, 5)
    const content = res?.content?.[0]
    expect(content?.type).toBe('text')
    expect(String(content?.text)).toContain('Invalid agent name')
  } finally {
    await srv.close()
  }
})
