import { expect } from '@std/expect'
import { FakeTime } from '@std/testing/time'
import type { Debugger } from 'debug'

import { createIdleShutdownManager } from './idle.ts'

const flushMicrotasks = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await Promise.resolve()
}

const createLogStub = () => {
  const calls: Array<[unknown, ...unknown[]]> = []
  const log = ((formatter: unknown, ...args: unknown[]) => {
    calls.push([formatter, ...args])
  }) as unknown as Debugger
  return { log, calls }
}

Deno.test('onIdle fires after the configured timeout when idle', async () => {
  const time = new FakeTime()
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 50,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  try {
    time.tick(49)
    await flushMicrotasks()
    expect(idleCount).toBe(0)

    time.tick(1)
    await flushMicrotasks()
    expect(idleCount).toBe(1)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('waits for in-flight activity before shutting down', async () => {
  const time = new FakeTime()
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 50,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  try {
    const activity = idle.runWithActivity(
      () => new Promise<void>((resolve) => setTimeout(resolve, 60)),
      'long activity',
    )
    expect(idle.debugState().inFlight.size).toBe(1)

    time.tick(50)
    await flushMicrotasks()
    expect(idleCount).toBe(0)

    time.tick(10)
    await activity
    await flushMicrotasks()
    expect(idleCount).toBe(1)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('touch restarts the idle timeout', async () => {
  const time = new FakeTime()
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 40,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  try {
    time.tick(30)
    idle.touch('manual refresh')
    await flushMicrotasks()

    time.tick(39)
    await flushMicrotasks()
    expect(idleCount).toBe(0)

    time.tick(1)
    await flushMicrotasks()
    expect(idleCount).toBe(1)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('handlePendingChange blocks shutdown until interactions clear', async () => {
  const time = new FakeTime()
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 60,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  try {
    idle.handlePendingChange(2)
    expect(idle.debugState().inFlight.size).toBe(1)

    time.tick(60)
    await flushMicrotasks()
    expect(idleCount).toBe(0)
    expect(idle.debugState().pendingShutdown).toBe(true)

    idle.handlePendingChange(0)
    expect(idle.debugState().inFlight.size).toBe(0)
    expect(idle.debugState().pendingShutdown).toBe(false)

    time.tick(59)
    await flushMicrotasks()
    expect(idleCount).toBe(0)

    time.tick(1)
    await flushMicrotasks()
    expect(idleCount).toBe(1)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('handlePendingChange reuses a single counter object', () => {
  const time = new FakeTime()
  const { log } = createLogStub()

  const idle = createIdleShutdownManager({
    timeoutMs: 40,
    onIdle: () => {
      // ignore
    },
    log,
  })

  try {
    idle.handlePendingChange(1)
    expect(idle.debugState().inFlight.size).toBe(1)

    idle.handlePendingChange(3)
    expect(idle.debugState().inFlight.size).toBe(1)

    idle.handlePendingChange(0)
    expect(idle.debugState().inFlight.size).toBe(0)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('dispose cancels scheduled shutdowns', async () => {
  const time = new FakeTime()
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 30,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  try {
    idle.dispose()

    time.tick(100)
    await flushMicrotasks()
    expect(idleCount).toBe(0)
  } finally {
    idle.dispose()
    time.restore()
  }
})

Deno.test('post-shutdown activity does not underflow in-flight counter', async () => {
  const { log } = createLogStub()
  let idleCount = 0

  const idle = createIdleShutdownManager({
    timeoutMs: 25,
    onIdle: () => {
      idleCount += 1
    },
    log,
  })

  idle.dispose()

  const value = await idle.runWithActivity(() => 42, 'post-shutdown work')
  expect(value).toBe(42)
  expect(idleCount).toBe(0)
  expect(idle.debugState().inFlight.size).toBe(0)
  expect(idle.debugState().shuttingDown).toBe(true)
})
