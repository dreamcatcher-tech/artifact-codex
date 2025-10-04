#!/usr/bin/env -S deno run
import { join } from '@std/path'
import type {
  Agent,
  AgentOptions,
  AgentStatus,
  AgentView,
} from '@artifact/shared'
import { HOST, launchTmuxTerminal } from '@artifact/shared'

/**
 * Start a Face that launches the MCP Inspector via `npx -y @modelcontextprotocol/inspector`.
 * - Adds discovered UI/proxy server ports to status.
 * - Throws on interaction requests (non-interactive face).
 * - By default, only launches the child when both `workspace` and `home` are provided in opts.
 */
export interface FaceInspectorOptions extends AgentOptions {
  config?: { test?: boolean }
}

export function startAgentInspector(opts: FaceInspectorOptions = {}): Agent {
  if (!opts.workspace || !opts.home) {
    throw new Error('agent-inspector requires workspace and home options')
  }
  const startedAt = new Date()
  let closed = false
  const interactions = 0
  let lastInteractionId: string | undefined

  // Child process + runtime state
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  let views: AgentView[] = []

  // readiness gate: status() resolves after the face is ready
  let readyResolve: (() => void) | null = null
  const ready: Promise<void> = new Promise((res) => (readyResolve = res))

  function markReady() {
    if (readyResolve) {
      readyResolve()
      readyResolve = null
    }
  }

  async function maybeLaunch() {
    if (!opts.workspace || !opts.home) {
      throw new Error(
        'agent-inspector requires both workspace and home options',
      )
    }

    // Ensure the provided directories exist; create home if missing
    const workspaceDir = opts.workspace
    const homeDir = opts.home
    try {
      const st = await Deno.stat(workspaceDir)
      if (!st.isDirectory) throw new Error('workspace is not a directory')
    } catch {
      throw new Error(`workspace directory not found: ${workspaceDir}`)
    }
    try {
      const st = await Deno.stat(homeDir)
      if (!st.isDirectory) throw new Error('home is not a directory')
    } catch {
      await Deno.mkdir(homeDir, { recursive: true })
    }

    const config = opts.config ?? {}
    const TTYD_PORT = 10000
    // Test mode: do not spawn external processes; just set stub views
    if (config.test) {
      views = [
        {
          name: 'terminal',
          port: TTYD_PORT,
          protocol: 'http',
          url: `https://${HOST}:${TTYD_PORT}`,
        },
        {
          name: 'client',
          port: TTYD_PORT + 1,
          protocol: 'http',
          url: `https://${HOST}:${TTYD_PORT + 1}`,
        },
      ]
      markReady()
      return
    }
    const uiPort = TTYD_PORT + 1
    const apiPort = TTYD_PORT + 2

    const session = `agent-inspector-${crypto.randomUUID().slice(0, 8)}`
    const env: Record<string, string> = {
      // Network binds
      HOST,
      ALLOWED_ORIGINS: '*',
      MCP_AUTO_OPEN_ENABLED: 'false',
      // Encourage common dev servers to use our chosen port/host
      PORT: String(uiPort),
      CLIENT_PORT: String(uiPort),
      SERVER_PORT: String(apiPort),
      MCP_PROXY_FULL_ADDRESS: `http://${HOST}:${apiPort}`,

      // tmux launcher related (explicitly read-only by leaving WRITEABLE off)
      SESSION: session,
      TTYD_PORT: String(TTYD_PORT),
      TTYD_HOST: HOST,
    }

    const { child: proc } = await launchTmuxTerminal({
      command: ['npx', '-y', '@modelcontextprotocol/inspector'],
      session,
      ttydPort: TTYD_PORT,
      ttydHost: HOST,
      cwd: workspaceDir,
      env,
    })

    // Success
    child = proc
    pid = proc.pid
    views = [
      {
        name: 'terminal',
        port: TTYD_PORT,
        protocol: 'http',
        url: `http://${HOST}:${TTYD_PORT}`,
      },
      {
        name: 'client',
        port: uiPort,
        protocol: 'http',
        url: `http://${HOST}:${uiPort}`,
      },
    ]

    markReady()
  }

  // fire-and-forget launch
  maybeLaunch()

  function interaction(): never {
    throw new Error('agent-inspector is non-interactive')
  }

  async function cancel(_id: string) {
    await Promise.resolve()
  }

  async function destroy() {
    closed = true
    try {
      child?.kill('SIGTERM')
    } catch {
      // ignore
    }
    try {
      await child?.status
    } catch {
      // ignore
    }
  }

  async function status(): Promise<AgentStatus> {
    // Only resolves once loading is complete
    await ready
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions,
      lastInteractionId,
      pid,
      views,
      config: opts.home ? join(opts.home) : undefined,
      home: opts.home ? join(opts.home) : undefined,
      workspace: opts.workspace ? join(opts.workspace) : undefined,
    }
  }

  async function awaitInteraction(_id: string): Promise<string> {
    await Promise.resolve()
    throw new Error('agent-inspector has no pending interactions')
  }

  return { interaction, awaitInteraction, cancel, status, destroy }
}
