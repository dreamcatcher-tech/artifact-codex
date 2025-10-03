import { expect } from '@std/expect'

const envDefaults: Record<string, string> = {
  DC_NFS: 'nfs-proto.flycast',
  DC_ROUTER: 'router.internal',
  DC_DOMAIN: 'example.test',
  DC_EXEC: 'exec.internal',
  DC_WORKER_POOL_APP: 'worker-pool',
  DC_FLY_API_TOKEN: 'test-token',
  DC_OPENAI_PROXY_BASE_URL: 'https://openai-proxy.example.test',
}

for (const [name, value] of Object.entries(envDefaults)) {
  if (Deno.env.get(name) === undefined) {
    Deno.env.set(name, value)
  }
}

const { createHostCoderOptions, resolveFaceKinds } = await import(
  './app.ts'
)

Deno.test('resolveFaceKinds exposes codex face by default', () => {
  const faceKinds = resolveFaceKinds()
  expect(faceKinds.length).toBeGreaterThan(0)
  const ids = faceKinds.map((face) => face.id)
  expect(ids).toContain('codex')
})

Deno.test('createHostCoderOptions sets default face to codex', () => {
  const options = createHostCoderOptions()
  expect(options.defaultFaceKindId).toEqual('codex')
  expect(options.faceKinds.length).toBeGreaterThan(0)
})

Deno.test('createHostCoderOptions forwards idle shutdown options', () => {
  const idleShutdown = {
    timeoutMs: 123,
    onIdle: () => {},
  }
  const options = createHostCoderOptions({ idleShutdown })
  expect(options.idleShutdown).toBe(idleShutdown)
})
