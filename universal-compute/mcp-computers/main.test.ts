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

async function spawnServer(env?: Record<string, string>) {
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
    env,
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
        const { done } = await errReader.read()
        if (done) break
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
              const r = pending.get(msg.id ?? '')
              if (r) {
                pending.delete(msg.id ?? '')
                r(msg)
              }
            }
          } catch (_) {
            /* ignore */
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
    const w = child.stdin.getWriter()
    try {
      await w.write(enc.encode(JSON.stringify(req) + '\n'))
    } finally {
      w.releaseLock()
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

Deno.test({
  name: 'MCP initialize handshake',
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
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
    expect(result.serverInfo?.name).toBe('computer-mcp')
    expect(typeof result.protocolVersion).toBe('string')
  } finally {
    await srv.close()
  }
})

Deno.test({
  name: 'no org token => tools/list not available',
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
    let err: unknown
    try {
      await srv.request('tools/list', {}, 2)
    } catch (e) {
      err = e
    }
    expect(String(err)).toContain('tools/list error')
    expect(String(err)).toContain('Method not found')
  } finally {
    await srv.close()
  }
})

Deno.test({
  name: 'org-scoped token => computer tools exposed',
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const srv = await spawnServer({
    FLY_API_TOKEN: 'TEST_ORG',
    FLY_APP_NAME: 'dummy',
  })
  try {
    await srv.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.1.0' },
    }, 1)
    type ToolsListResult = { tools?: { name: string }[] }
    const list = await srv.request<ToolsListResult>('tools/list', {}, 2)
    const names = (list.tools ?? []).map((t) => t.name)
    expect(names).toContain('create_computer')
    expect(names).toContain('list_computers')
    expect(names).toContain('read_computer')
    expect(names).toContain('destroy_computer')
    expect(names).not.toContain('list_agents')
  } finally {
    await srv.close()
  }
})

Deno.test('create_computer rejects invalid userId early (org token)', async () => {
  await using srv = await spawnServer({
    FLY_API_TOKEN: 'TEST_ORG',
    FLY_APP_NAME: 'dummy',
  })
  await srv.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.1.0' },
  }, 1)
  type ToolsCallTextResult = { content?: { type: string; text?: string }[] }
  const res = await srv.request<ToolsCallTextResult>('tools/call', {
    name: 'create_computer',
    arguments: { userId: 'Bad_User' },
  }, 6)
  const content = res?.content?.[0]
  expect(content?.type).toBe('text')
  expect(String(content?.text)).toContain('Invalid computer name')
})
