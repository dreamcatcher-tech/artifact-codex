#!/usr/bin/env -S deno run
import type { Face, FaceOptions } from '@artifact/shared'

/**
 * A minimal Face that echoes inputs. Used for exercising error paths.
 * - Returns the same string on interaction.
 * - Special input: "error" throws to test error handling.
 */
export function startFaceTest(_opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  const active = new Map<string, Promise<string>>()

  function interaction(input: string) {
    assertOpen()
    const id = count.toString()
    const promise: Promise<string> = Promise
      .resolve()
      .then(() => {
        if (input.toLowerCase() === 'error') {
          throw new Error('intentional test error')
        }
        return input
      })
    active.set(id, promise)
    lastId = id
    count += 1
    return { id }
  }

  function cancel(id: string) {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    active.delete(id)
    return Promise.resolve()
  }

  async function destroy() {
    closed = true
    await Promise.resolve()
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions: count,
      lastInteractionId: lastId,
    }
  }

  async function waitFor(id: string) {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    try {
      return await rec
    } finally {
      active.delete(id)
    }
  }

  return { interaction, waitFor, cancel, status, destroy }
}
