import { expect } from '@std/expect'
import { join } from '@std/path'
import { prepareLaunchDirectories } from './config.ts'

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
  try {
    const prep1 = await prepareLaunchDirectories({ workspace })
    expect(prep1).toBeDefined()
    const home1 = prep1!.home
    const bucketRoot = join(workspace, '.dreamcatcher', 'face-codex')
    expect(home1.startsWith(bucketRoot)).toBe(true)
    expect(await pathExists(home1)).toBe(true)
    expect(await pathExists(join(home1, 'config.toml'))).toBe(true)
    expect(home1.includes('~')).toBe(false)

    const prep2 = await prepareLaunchDirectories({ workspace })
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
  try {
    await expect(
      prepareLaunchDirectories({ workspace, home: '~/codex' }),
    ).rejects.toThrow('home paths under ~ are not permitted')
  } finally {
    await Deno.remove(workspace, { recursive: true })
  }
})
