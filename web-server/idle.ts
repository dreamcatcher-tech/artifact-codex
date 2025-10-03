import type { Debugger } from 'debug'
import type { Context, MiddlewareHandler, Next } from '@hono/hono'

export interface IdleShutdownOptions {
  timeoutMs: number
  onIdle: () => void
  log: Debugger
}

export interface IdleShutdownManager {
  middleware: MiddlewareHandler
  touch: (reason: string) => void
  dispose: () => void
  runWithActivity: <T>(fn: () => Promise<T> | T, reason: string) => Promise<T>
  handlePendingChange: (pendingCount: number) => void
  debugState: () => {
    inFlight: Set<Record<string, unknown>>
    pendingShutdown: boolean
    shuttingDown: boolean
  }
}

export function createIdleShutdownManager(
  options: IdleShutdownOptions,
): IdleShutdownManager {
  const { timeoutMs, onIdle, log } = options

  let timer: ReturnType<typeof setTimeout> | null = null
  const inFlight = new Set<Record<string, unknown>>()
  let pendingShutdown = false
  let shuttingDown = false
  let pendingInteractionsCounter: Record<string, unknown> | null = null

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const triggerIdleCallback = () => {
    if (shuttingDown) return
    shuttingDown = true
    pendingShutdown = false
    clearTimer()
    log('idle shutdown after %dms without traffic', timeoutMs)
    queueMicrotask(() => {
      Promise.resolve(onIdle()).catch((error) => {
        log('idle shutdown: onIdle failed %O', error)
      })
    })
  }

  const scheduleTimer = (reason: string) => {
    if (shuttingDown) return
    clearTimer()
    timer = setTimeout(handleTimeout, timeoutMs)
    log('idle shutdown: timer scheduled for %dms (%s)', timeoutMs, reason)
  }

  const touch = (reason: string) => {
    if (shuttingDown) return
    pendingShutdown = false
    scheduleTimer(reason)
  }

  const handleTimeout = () => {
    timer = null
    if (inFlight.size > 0) {
      log(
        'idle shutdown: waiting for %d in-flight requests to finish',
        inFlight.size,
      )
      pendingShutdown = true
      return
    }
    triggerIdleCallback()
  }

  const finishActivity = (counter: Record<string, unknown>) => {
    inFlight.delete(counter)
    if (!shuttingDown) {
      if (inFlight.size === 0) {
        if (pendingShutdown) {
          triggerIdleCallback()
        } else {
          scheduleTimer('activity complete')
        }
      }
    }
  }

  const handlePendingChange = (pendingCount: number) => {
    if (pendingCount > 0) {
      if (!pendingInteractionsCounter) {
        pendingInteractionsCounter = {
          reason: 'pending interactions',
          createdAt: Date.now(),
        }
      }
      inFlight.add(pendingInteractionsCounter)
      touch(`pending interactions ${pendingCount}`)
      return
    }

    if (!pendingInteractionsCounter) {
      return
    }

    const counter = pendingInteractionsCounter
    pendingInteractionsCounter = null
    inFlight.delete(counter)
    touch('pending interactions cleared')
  }

  const runWithActivity = async <T>(
    fn: () => Promise<T> | T,
    reason: string,
  ): Promise<T> => {
    const counter = { reason, timestamp: Date.now(), shuttingDown }
    if (!shuttingDown) {
      pendingShutdown = false
      inFlight.add(counter)
      scheduleTimer(reason)
    }
    try {
      const result = fn()
      return result instanceof Promise ? await result : result
    } finally {
      finishActivity(counter)
    }
  }

  const dispose = () => {
    shuttingDown = true
    clearTimer()
  }

  const middleware = async (c: Context, next: Next) => {
    return await runWithActivity(() => next(), `request ${c.req.method}`)
  }

  scheduleTimer('initial')

  const debugState = () => ({ inFlight, pendingShutdown, shuttingDown })

  return {
    middleware,
    touch,
    dispose,
    runWithActivity,
    handlePendingChange,
    debugState,
  }
}
