#!/usr/bin/env -S deno run
import type { Face, FaceOptions, FaceView } from '@artifact/shared'
import { HOST, idCheck } from '@artifact/shared'

function createViews(opts: FaceOptions): FaceView[] {
  const hostname = opts.hostname ?? HOST
  return [{
    name: 'test-face',
    protocol: 'http',
    port: 0,
    url: `http://${hostname}`,
  }]
}

/**
 * Minimal Face used for exercising error paths.
 * Echoes input strings and throws when the input is "error".
 */
export function startFaceTest(opts: FaceOptions = {}): Face {
  const guardId = idCheck('interaction id')
  const pending = new Map<string, { value?: string; error?: Error }>()
  const views = createViews(opts)
  const startedAt = new Date().toISOString()
  let lastId: string | undefined
  let count = 0
  let closed = false

  function ensureOpen() {
    if (closed) throw new Error('face is closed')
  }

  function interaction(id: string, input: string) {
    ensureOpen()
    guardId(id)
    const entry = input.toLowerCase() === 'error'
      ? { error: new Error('intentional test error') }
      : { value: input }
    pending.set(id, entry)
    lastId = id
    count += 1
  }

  async function awaitInteraction(id: string) {
    await Promise.resolve()
    const entry = pending.get(id)
    if (!entry) throw new Error(`unknown interaction id: ${id}`)
    pending.delete(id)
    if (entry.error) throw entry.error
    return entry.value ?? ''
  }

  function cancel(id: string) {
    if (!pending.delete(id)) {
      throw new Error(`unknown interaction id: ${id}`)
    }
  }

  async function destroy() {
    closed = true
    pending.clear()
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt,
      closed,
      interactions: count,
      lastInteractionId: lastId,
      home: opts.home,
      workspace: opts.workspace,
      views,
    }
  }

  return { interaction, awaitInteraction, cancel, status, destroy }
}
