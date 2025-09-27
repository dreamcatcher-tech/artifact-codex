import { expect } from '@std/expect'
import { createQueue } from './queue.ts'

type TestDeferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

const createTestDeferred = <T>(): TestDeferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Run<T> = {
  computerId: string
  deferred: TestDeferred<T>
}

Deno.test('queue coalesces pending jobs per key', async () => {
  const runs: Run<number>[] = []
  const queue = createQueue<number>()

  const enqueue = (computerId: string) =>
    queue.enqueue(computerId, () => {
      const deferred = createTestDeferred<number>()
      runs.push({ computerId, deferred })
      return deferred.promise
    })

  const first = enqueue('computer-1')
  expect(typeof (first as Promise<number>).then).toBe('function')
  await Promise.resolve()
  expect(runs.length).toBe(1)

  const second = enqueue('computer-1')
  const third = enqueue('computer-1')
  expect(second).not.toBe(first)
  expect(third).toBe(second)
  expect(runs.length).toBe(1)

  runs[0].deferred.resolve(1)
  await Promise.resolve()
  expect(runs.length).toBe(2)

  runs[1].deferred.resolve(2)
  expect(await first).toBe(1)
  expect(await second).toBe(2)
  expect(await third).toBe(2)

  const fourth = enqueue('computer-1')
  expect(fourth).not.toBe(first)
  expect(fourth).not.toBe(second)
  await Promise.resolve()
  expect(runs.length).toBe(3)
  runs[2].deferred.resolve(3)
  expect(await fourth).toBe(3)
})

Deno.test('queue isolates keys', async () => {
  const runs: Run<number>[] = []
  const queue = createQueue<number>()

  const enqueue = (computerId: string) =>
    queue.enqueue(computerId, () => {
      const deferred = createTestDeferred<number>()
      runs.push({ computerId, deferred })
      return deferred.promise
    })

  const first = enqueue('computer-a')
  const second = enqueue('computer-b')
  await Promise.resolve()
  expect(runs.length).toBe(2)
  expect(new Set(runs.map((run) => run.computerId))).toEqual(
    new Set(['computer-a', 'computer-b']),
  )

  runs[0].deferred.resolve(1)
  runs[1].deferred.resolve(2)

  expect(await first).toBe(1)
  expect(await second).toBe(2)
})
