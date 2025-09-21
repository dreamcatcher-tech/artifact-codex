import { expect } from '@std/expect'

import { Workflow } from './workflow.ts'

const echo = (message: string) => ({
  id: crypto.randomUUID(),
  command: 'deno',
  args: ['eval', `console.log(${JSON.stringify(message)})`],
})

Deno.test('Workflow runs tasks sequentially', async () => {
  const workflow = new Workflow([
    echo('one'),
    echo('two'),
  ])

  const result = await workflow.run()

  expect(result.results.length).toBe(2)
  expect(result.success).toBe(true)
})

Deno.test('Workflow stops on failure by default', async () => {
  const workflow = new Workflow([
    echo('before'),
    {
      id: 'fail',
      command: 'deno',
      args: ['eval', 'Deno.exit(1)'],
    },
    echo('after'),
  ])

  const result = await workflow.run()

  expect(result.results.length).toBe(2)
  expect(result.results.at(-1)?.success).toBe(false)
  expect(result.success).toBe(false)
})

Deno.test('Workflow can be configured to continue after failure', async () => {
  const workflow = new Workflow([
    echo('keep-going'),
    {
      id: 'fail',
      command: 'deno',
      args: ['eval', 'Deno.exit(1)'],
    },
    echo('still-running'),
  ], { stopOnError: false })

  const result = await workflow.run()

  expect(result.results.length).toBe(3)
  expect(result.success).toBe(false)
})
