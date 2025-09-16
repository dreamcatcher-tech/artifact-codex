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

Deno.test('prepareLaunchDirectories isolates default home under dreamcatcher', async () => {
  const workspace = await Deno.makeTempDir()
  const tmpRoot = await Deno.makeTempDir()
  const fakeHome = join(tmpRoot, 'home')
  await Deno.mkdir(fakeHome, { recursive: true })

  const prevHome = Deno.env.get('HOME')
  const prevProfile = Deno.env.get('USERPROFILE')
  Deno.env.set('HOME', fakeHome)
  if (prevProfile !== undefined) {
    Deno.env.set('USERPROFILE', fakeHome)
  }

  try {
    const prep1 = await prepareLaunchDirectories({ workspace })
    expect(prep1).toBeDefined()
    const home1 = prep1!.home
    expect(home1.startsWith(join(fakeHome, '.dreamcatcher'))).toBe(true)
    expect(await pathExists(home1)).toBe(true)
    expect(await pathExists(join(home1, 'config.toml'))).toBe(true)

    const prep2 = await prepareLaunchDirectories({ workspace })
    expect(prep2).toBeDefined()
    const home2 = prep2!.home
    expect(home2.startsWith(join(fakeHome, '.dreamcatcher'))).toBe(true)
    expect(home2).not.toBe(home1)
    expect(await pathExists(home2)).toBe(true)
  } finally {
    if (prevHome === undefined) {
      Deno.env.delete('HOME')
    } else {
      Deno.env.set('HOME', prevHome)
    }
    if (prevProfile === undefined) {
      Deno.env.delete('USERPROFILE')
    } else {
      Deno.env.set('USERPROFILE', prevProfile)
    }
    await Deno.remove(workspace, { recursive: true })
    await Deno.remove(tmpRoot, { recursive: true })
  }
})
