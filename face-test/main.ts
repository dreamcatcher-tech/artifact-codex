#!/usr/bin/env -S deno run
import type { Face, FaceOptions } from '@artifact/shared'

/**
 * A minimal Face that echoes inputs. Used for exercising error paths.
 * - Returns the same string on interaction.
 * - Special input: "error" throws to test error handling.
 */
export function startFaceTest(opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  const active = new Map<string, { promise: Promise<string>; error?: Error }>()

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

    promise.catch((err) => {
      record.error = err
    })
    const record = { promise, error: undefined }
    active.set(id, record)
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
      home: opts.home,
      workspace: opts.workspace,
    }
  }

  async function awaitInteraction(id: string) {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    try {
      const result = await rec.promise
      if (rec.error) {
        throw rec.error
      }
      return result
    } finally {
      active.delete(id)
    }
  }

  return { interaction, awaitInteraction, cancel, status, destroy }
}
