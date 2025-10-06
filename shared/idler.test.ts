import { expect } from '@std/expect'
import { FakeTime } from '@std/testing/time'
import { createIdleTrigger } from './idler.ts'

Deno.test('idle throws when called with an unknown id', () => {
  const abort = new AbortController()
  const timer = createIdleTrigger(abort, 50)

  expect(() => timer.idle(0)).toThrow(
    'idle() called with invalid or duplicate id: 0',
  )
})

Deno.test('idle throws when invoked twice for the same id', () => {
  using time = new FakeTime()
  const abort = new AbortController()
  const timer = createIdleTrigger(abort, 1000)
  const id = timer.busy()

  timer.idle(id)
  expect(() => timer.idle(id)).toThrow(
    `idle() called with invalid or duplicate id: ${id}`,
  )

  time.tick(1000)
  expect(abort.signal.aborted).toBe(true)
})

Deno.test('idle schedules abort once all busy work has completed', () => {
  using time = new FakeTime()

  const abort = new AbortController()
  const timer = createIdleTrigger(abort, 500)

  const first = timer.busy()
  const second = timer.busy()

  timer.idle(first)
  expect(abort.signal.aborted).toBe(false)

  time.tick(500)
  expect(abort.signal.aborted).toBe(false)

  timer.idle(second)
  expect(abort.signal.aborted).toBe(false)

  time.tick(499)
  expect(abort.signal.aborted).toBe(false)

  time.tick(1)
  expect(abort.signal.aborted).toBe(true)
})
