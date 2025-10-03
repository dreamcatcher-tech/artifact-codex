import { expect } from '@std/expect'
import { join } from '@std/path'
import { prepareLaunchDirectories } from './config.ts'

const OPENAI_KEY_ENV = 'OPENAI_API_KEY'

const createEnvGetter = (value: string | undefined) => (key: string) =>
  key === OPENAI_KEY_ENV ? value : undefined

async function pathExists(path: string) {
  try {
    await Deno.stat(path)
    return true
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false
    throw err
  }
}

Deno.test('prepareLaunchDirectories isolates default home under workspace bucket', async () => {
  const workspace = await Deno.makeTempDir()
  const getEnv = createEnvGetter('test-key')
  try {
    const prep1 = await prepareLaunchDirectories({
      workspace,
      config: { getEnv },
    })
    expect(prep1).toBeDefined()
    const home1 = prep1!.home
    const bucketRoot = join(workspace, '.dreamcatcher', 'agent-codex')
    expect(home1.startsWith(bucketRoot)).toBe(true)
    expect(await pathExists(home1)).toBe(true)
    expect(await pathExists(join(home1, 'config.toml'))).toBe(true)
    const auth1 = JSON.parse(await Deno.readTextFile(join(home1, 'auth.json')))
    expect(auth1).toEqual({ [OPENAI_KEY_ENV]: 'test-key' })
    expect(home1.includes('~')).toBe(false)

    const prep2 = await prepareLaunchDirectories({
      workspace,
      config: { getEnv },
    })
    expect(prep2).toBeDefined()
    const home2 = prep2!.home
    expect(home2.startsWith(bucketRoot)).toBe(true)
    expect(home2).not.toBe(home1)
    expect(await pathExists(home2)).toBe(true)
  } finally {
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('prepareLaunchDirectories rejects home under tilde', async () => {
  const workspace = await Deno.makeTempDir()
  const getEnv = createEnvGetter('test-key')
  try {
    await expect(
      prepareLaunchDirectories({
        workspace,
        home: '~/codex',
        config: { getEnv },
      }),
    ).rejects.toThrow('home paths under ~ are not permitted')
  } finally {
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('prepareLaunchDirectories requires OPENAI_API_KEY env', async () => {
  const workspace = await Deno.makeTempDir()
  const getEnv = createEnvGetter(undefined)
  try {
    await expect(
      prepareLaunchDirectories({ workspace, config: { getEnv } }),
    ).rejects.toThrow('environment variable required: OPENAI_API_KEY')
  } finally {
    await Deno.remove(workspace, { recursive: true })
  }
})
