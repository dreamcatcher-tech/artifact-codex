import { expect } from '@std/expect'
import { dirname, fromFileUrl, join } from '@std/path'

const MODULE_DIR = dirname(fromFileUrl(import.meta.url))
const MOCK_APP = join(MODULE_DIR, 'mock-app.ts')
const NOTIFY_SCRIPT = join(MODULE_DIR, 'notify.ts')

Deno.test('mock app trims input before forwarding to notify', async () => {
  const dir = await Deno.makeTempDir()
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      MOCK_APP,
      '--notify',
      NOTIFY_SCRIPT,
      '--dir',
      dir,
    ],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'null',
  })
  const child = command.spawn()
  try {
    const stdin = child.stdin
    if (!stdin) {
      throw new Error('expected piped stdin')
    }
    const writer = stdin.getWriter()
    try {
      const encoder = new TextEncoder()
      await writer.write(encoder.encode('   echo hi   \n'))
    } finally {
      await writer.close()
      writer.releaseLock()
    }
    const status = await child.status
    expect(status.success).toBe(true)
    const payloadPath = join(dir, 'notify.json')
    const payloadText = await Deno.readTextFile(payloadPath)
    const payload = JSON.parse(payloadText)
    expect(payload['input-messages']).toEqual(['echo hi'])
    expect(payload['last-assistant-message']).toBe('done: echo hi')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
