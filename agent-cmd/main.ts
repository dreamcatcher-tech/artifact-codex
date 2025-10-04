#!/usr/bin/env -S deno run
import type { Agent, AgentOptions, AgentView } from '@artifact/shared'
import { HOST, launchTmuxTerminal, sendKeysViaTmux } from '@artifact/shared'

type CmdConfig = {
  /** Command and args to run inside tmux. Example: ["bash", "-lc", "htop"] */
  command: string[]
  /** Optional window title for tmux + ttyd */
  title?: string
}

export function startAgentCmd(
  opts: AgentOptions = {},
): Agent {
  const startedAt = new Date()
  let closed = false
  let interactions = 0
  let lastInteractionId: string | undefined

  // tmux/ttyd state
  let views: AgentView[] | undefined
  let tmuxSession: string | undefined
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  let cwd: string | undefined

  // Simple interaction bookkeeping: resolve immediately after send-keys
  const active = new Map<string, Promise<string>>()

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  async function maybeLaunch() {
    if (!opts.workspace) return
    const cfg = (opts.config ?? {}) as Partial<CmdConfig>
    if (
      !cfg.command || !Array.isArray(cfg.command) || cfg.command.length === 0
    ) {
      throw new Error('config.command must be a non-empty string[]')
    }

    cwd = opts.workspace
    try {
      const st = await Deno.stat(cwd)
      if (!st.isDirectory) throw new Error()
    } catch {
      throw new Error(`workspace directory not found: ${cwd}`)
    }

    tmuxSession = `agent-cmd-${crypto.randomUUID().slice(0, 8)}`
    const extHost = HOST

    const TTYD_PORT = 10000
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      SESSION: tmuxSession,
      TTYD_PORT: String(TTYD_PORT),
      HOST,
      TTYD_HOST: extHost,
      WRITEABLE: 'on',
    }
    const { child: proc } = await launchTmuxTerminal({
      command: [...cfg.command],
      session: tmuxSession,
      ttydPort: TTYD_PORT,
      ttydHost: extHost,
      cwd,
      env,
      writeable: true,
    })
    child = proc
    pid = proc.pid
    views = [{
      name: 'terminal',
      port: TTYD_PORT,
      protocol: 'http',
      url: `http://${extHost}:${TTYD_PORT}`,
    }]
  }

  // Fire-and-forget launch
  maybeLaunch()

  function interaction(id: string, input: string) {
    assertOpen()
    interactions += 1
    lastInteractionId = id

    const p = (async () => {
      try {
        if (tmuxSession) {
          await sendKeysViaTmux(tmuxSession, String(input))
        }
      } catch {
        // ignore
      }
      return 'ok'
    })()
    active.set(id, p)
  }

  async function awaitInteraction(id: string): Promise<string> {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    try {
      return await rec
    } finally {
      active.delete(id)
    }
  }

  function cancel(id: string) {
    const rec = active.get(id)
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    active.delete(id)
    return Promise.resolve()
  }

  async function destroy() {
    closed = true
    if (child) {
      try {
        child.kill('SIGTERM')
        try {
          await child.status
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions,
      lastInteractionId,
      pid,
      home: opts.home,
      workspace: cwd ?? opts.workspace,
      views,
    }
  }

  return { interaction, awaitInteraction, cancel, destroy, status }
}
