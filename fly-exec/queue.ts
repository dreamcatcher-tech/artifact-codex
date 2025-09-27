export type QueueStatus = 'started' | 'queued' | 'coalesced'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type Job<T> = () => Promise<T>

type Entry<T> = {
  current: { job: Job<T>; deferred: Deferred<T> }
  pending?: { job: Job<T>; deferred: Deferred<T> }
  running: boolean
}

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export const createQueue = <T>() => {
  const entries = new Map<string, Entry<T>>()

  const run = async (key: string, entry: Entry<T>) => {
    entry.running = true
    try {
      for (;;) {
        const { job, deferred } = entry.current
        try {
          deferred.resolve(await job())
        } catch (error) {
          deferred.reject(error)
        }

        if (!entry.pending) break
        entry.current = entry.pending
        entry.pending = undefined
      }
    } finally {
      entry.running = false
      entries.delete(key)
    }
  }

  const enqueue = (key: string, job: Job<T>) => {
    const deferred = defer<T>()
    const existing = entries.get(key)

    if (!existing) {
      const entry: Entry<T> = {
        current: { job, deferred },
        running: false,
      }
      entries.set(key, entry)
      queueMicrotask(() => run(key, entry))
      return deferred.promise
    }

    if (!existing.pending) {
      existing.pending = { job, deferred }
      return deferred.promise
    }

    return existing.pending.deferred.promise
  }

  return { enqueue }
}
