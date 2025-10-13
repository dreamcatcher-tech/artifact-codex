import type { MiddlewareHandler } from '@hono/hono'

export function createIdleTrigger(ac: AbortController, timeoutMs: number) {
  let timer: number | undefined
  let nextId = 0
  const activeBusy = new Set<number>()

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  ac.signal.addEventListener('abort', clearTimer, { once: true })

  function idle(id: number) {
    if (!activeBusy.has(id)) {
      throw new Error(`idle() called with invalid or duplicate id: ${id}`)
    }
    activeBusy.delete(id)
    if (activeBusy.size === 0) {
      clearTimer()
      timer = setTimeout(() => {
        ac.abort()
      }, timeoutMs)
    }
  }

  function busy(): number {
    const id = nextId++
    activeBusy.add(id)
    clearTimer()
    return id
  }

  const middleware: MiddlewareHandler = async (_, next) => {
    const id = busy()
    try {
      await next()
    } finally {
      idle(id)
    }
  }

  const touch = () => {
    const id = busy()
    idle(id)
  }

  const abort = () => {
    clearTimer()
    ac.abort()
  }

  return { busy, idle, middleware, touch, abort }
}

export type IdleTrigger = ReturnType<typeof createIdleTrigger>
