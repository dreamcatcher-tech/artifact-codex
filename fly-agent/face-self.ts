#!/usr/bin/env -S deno run
import type { Face, FaceOptions, FaceView } from '@artifact/shared'
import { HOST } from '@artifact/shared'

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

/**
 * Create a Face that represents the tmux + ttyd launcher that started this
 * fly-agent process. It does not spawn new processes; it only references the
 * existing tmux session/socket and the ttyd port.
 */
export function createVirtualFace(_opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  const views: FaceView[] | undefined = (() => {
    const port = Number(env('TTYD_PORT') ?? '')
    if (!Number.isFinite(port) || port <= 0) return undefined
    const extHost = env('TTYD_HOST') ?? HOST
    return [{
      name: 'terminal',
      port,
      protocol: 'http',
      url: `http://${extHost}:${port}`,
    }]
  })()

  const msg =
    'face-self cannot be interacted with, lest it kill the ability for any face to operate'

  function interaction(): never {
    throw new Error(msg)
  }

  function awaitInteraction(_id: string): Promise<string> {
    throw new Error(msg)
  }

  function cancel(_id: string) {
    throw new Error(msg)
  }

  function destroy() {
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed: false,
      interactions: 0,
      lastInteractionId: undefined,
      pid: Deno.pid,
      views,
      home: env('HOME'),
      workspace: Deno.cwd(),
    }
  }

  return { interaction, awaitInteraction, cancel, destroy, status }
}
