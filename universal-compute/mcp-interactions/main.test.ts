import { expect } from '@std/expect'

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

  const outReader = child.stdout.getReader()
  const errReader = child.stderr.getReader()

  let outBuf = ''
  const pending: Map<number | string, (r: JsonRpcResponse) => void> = new Map()
  ;(async () => {
    try {
      while (true) {
        const { value: _value, done } = await errReader.read()
        if (done) break
        // optional: console.error(dec.decode(_value))
      }
    } catch (_) {
      /* ignore */
    }
  })()
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
            if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
              const resolver = pending.get(msg.id ?? '')
              if (resolver) {
                pending.delete(msg.id ?? '')
                resolver(msg)
              }
            }
          } catch (_) {
            /* ignore non-JSON lines */
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
  })()

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
    try {
      child.kill('SIGTERM')
    } catch (_) {
      /* ignore */
    }
    await child.status
    try {
      outReader.releaseLock()
    } catch (_) {
      /* ignore */
    }
    try {
      errReader.releaseLock()
    } catch (_) {
      /* ignore */
    }
    try {
      child.stdin.close()
    } catch (_) {
      /* ignore */
    }
  }

  return { child, request, close, [Symbol.asyncDispose]: close } as const
}

Deno.test(
  {
    name: 'MCP initialize handshake',
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async () => {
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
      expect(result?.serverInfo?.name).toBe('interactions-mcp')
      expect(typeof result?.protocolVersion).toBe('string')
    } finally {
      await srv.close()
    }
  },
)

Deno.test({
  name: 'tools/list includes interaction tools',
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
    expect(names).toContain('list_interactions')
    expect(names).toContain('create_interaction')
    expect(names).toContain('read_interaction')
    expect(names).toContain('destroy_interaction')
  } finally {
    await srv.close()
  }
})
