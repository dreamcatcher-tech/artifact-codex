import { expect } from '@std/expect'

import { runCommand, Task, TaskError } from './task.ts'

Deno.test('Task runs a command and captures output', async () => {
  const task = new Task({
    id: 'echo',
    command: 'deno',
    args: ['eval', "console.log('hello')"],
  })

  const result = await task.run()

  expect(result.success).toBe(true)
  expect(result.stdout.trim()).toBe('hello')
  expect(result.stderr).toBe('')
  expect(task.pid).toBeNull()
})

Deno.test('Task supports piping stdin content', async () => {
  const script = [
    'const decoder = new TextDecoder()',
    'const body = await new Response(Deno.stdin.readable).text()',
    'console.log(body.trim())',
  ].join('; ')

  const task = new Task({
    id: 'stdin',
    command: 'deno',
    args: ['eval', script],
    stdin: 'hello world\n',
  })

  const result = await task.run()

  expect(result.stdout.trim()).toBe('hello world')
  expect(result.success).toBe(true)
})

Deno.test('Task throws TaskError when check enabled and command fails', async () => {
  const task = new Task({
    id: 'fail',
    command: 'deno',
    args: ['eval', 'Deno.exit(2)'],
    check: true,
  })

  await expect(task.run()).rejects.toBeInstanceOf(TaskError)
})

Deno.test('Task start returns handle with status promise', async () => {
  const task = new Task({
    id: 'sleep',
    command: 'deno',
    args: ['eval', 'await new Promise((r) => setTimeout(r, 10));'],
  })

  const handle = await task.start()
  const result = await handle.status

  expect(result.success).toBe(true)
  expect(task.pid).toBeNull()
})

Deno.test('Task respects stdio configuration', async () => {
  const result = await runCommand({
    command: 'deno',
    args: ['eval', "console.error('oops'); console.log('hi')"],
    stdio: { stdout: 'inherit', stderr: 'piped' },
  })

  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('oops')
})

Deno.test('Task validation fails when command is missing', async () => {
  const task = new Task({
    id: 'missing',
    command: 'this-command-should-not-exist',
  })

  await expect(task.validate()).rejects.toThrow('Command not found')
})

Deno.test('Task validation detects unavailable ports', async () => {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const port = (listener.addr as Deno.NetAddr).port

  const task = new Task({
    id: 'port-check',
    command: 'deno',
    args: ['eval', "console.log('ok')"],
    ports: [port],
  })

  try {
    await expect(task.validate()).rejects.toThrow(`Port ${port} is unavailable`)
  } finally {
    listener.close()
  }
})
