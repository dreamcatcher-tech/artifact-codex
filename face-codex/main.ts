#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions } from '@artifact/shared'
import { startNotifyWatcher } from './notify_watcher.ts'

/**
 * Start a lightweight in-memory "face" that echoes interactions and tracks status.
 */
type CodexConfig = {
  test?: boolean
}

export function startFaceCodex(
  opts: FaceOptions & { config?: CodexConfig } = {},
): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined
  const active = new Map<string, Promise<string>>()

  // Child process state (when launching)
  let child: Deno.ChildProcess | undefined
  let pid: number | undefined
  let configDir: string | undefined
  let workspaceDir: string | undefined
  let lastNotificationRaw: string | undefined
  let notifications = 0
  let pendingNotifyWatcher: Promise<void> | null = null

  async function ensureConfigIfNeeded() {
    // Only act when both directories are provided (implies launch)
    if (!opts.workspace || !opts.home) return
    configDir = opts.home
    // Must not create directories; error if missing
    try {
      const st = await Deno.stat(configDir)
      if (!st.isDirectory) {
        throw new Error(`home is not a directory: ${configDir}`)
      }
    } catch {
      throw new Error(`home directory not found: ${configDir}`)
    }

    // Compute repo root and load template
    const thisFile = fromFileUrl(import.meta.url)
    const thisDir = dirname(thisFile)
    const repoRoot = dirname(thisDir) // face-codex/..
    const templatePath = join(thisDir, 'codex.config.toml')
    let template = await Deno.readTextFile(templatePath)

    // Rewrite MCP command paths from "/headers/<pkg>/main.ts" to absolute
    const abs = (pkg: string) => join(repoRoot, pkg, 'main.ts')
    const replacements: Record<string, string> = {
      '/headers/mcp-computers/main.ts': abs('mcp-computers'),
      '/headers/mcp-agents/main.ts': abs('mcp-agents'),
      '/headers/mcp-faces/main.ts': abs('mcp-faces'),
      '/headers/mcp-interactions/main.ts': abs('mcp-interactions'),
    }
    for (const [needle, value] of Object.entries(replacements)) {
      template = template.split(needle).join(value)
    }

    // Inject notify command to call our notify script with required permissions.
    const notifyScript = join(thisDir, 'notify.ts')
    const notifyArr = [
      'deno',
      'run',
      `--allow-write=${configDir}`,
      notifyScript,
      '--dir',
      String(configDir),
    ]
    if (!/\nnotify\s*=/.test(template)) {
      const notifyListStr = notifyArr
        .map((s) => JSON.stringify(s))
        .join(', ')
      template += `\nnotify = [${notifyListStr}]\n`
    }

    const outPathCodex = join(configDir, 'config.toml')
    await Deno.writeTextFile(outPathCodex, template)
  }

  async function maybeLaunch() {
    if (!opts.workspace || !opts.home) return
    await ensureConfigIfNeeded()
    workspaceDir = opts.workspace
    // Must not create directories; error if missing
    try {
      const st = await Deno.stat(workspaceDir)
      if (!st.isDirectory) {
        throw new Error(`workspace is not a directory: ${workspaceDir}`)
      }
    } catch {
      throw new Error(`workspace directory not found: ${workspaceDir}`)
    }

    const cfg = (opts.config ?? {}) as CodexConfig
    let cmd: Deno.Command
    if (cfg.test) {
      // Test mode: run mock-app directly so we can pipe stdin for the test.
      const thisDir = dirname(fromFileUrl(import.meta.url))
      const mock = join(thisDir, 'mock-app.ts')
      const args = [
        'run',
        '-A',
        mock,
        '--notify',
        join(thisDir, 'notify.ts'),
        '--dir',
        String(configDir!),
      ]
      cmd = new Deno.Command(Deno.execPath(), {
        args,
        cwd: workspaceDir,
        env: { ...Deno.env.toObject(), CODEX_HOME: configDir! },
        stdin: 'piped',
        stdout: 'inherit',
        stderr: 'inherit',
      })
    } else {
      // Real mode: use the generic tmux+ttyd script from shared.
      const thisDir = dirname(fromFileUrl(import.meta.url))
      const repoRoot = dirname(thisDir)
      const tmuxScript = join(repoRoot, 'shared', 'tmux.sh')

      const env = {
        ...Deno.env.toObject(),
        CODEX_HOME: configDir!,
        WINDOW_TITLE: 'Codex',
        SESSION: `face-codex-${crypto.randomUUID().slice(0, 8)}`,
        SOCKET: `face-codex-sock-${crypto.randomUUID().slice(0, 8)}`,
        PORT: String(17860),
        TTYD_PORT: String(17860),
        HOST: 'localhost',
        WRITEABLE: 'on',
      }

      cmd = new Deno.Command(tmuxScript, {
        args: ['npx', '-y', '@openai/codex', '--cd', workspaceDir],
        cwd: workspaceDir,
        env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
    }

    child = cmd.spawn()
    pid = child.pid // Observe exit asynchronously
    ;(async () => {
      try {
        await child!.status
      } finally {
        destroy()
      }
    })()
  }

  // Fire and forget; preserve original lightweight semantics if not launching
  maybeLaunch()

  function assertOpen() {
    if (closed) throw new Error('face is closed')
  }

  function interaction(input: string) {
    assertOpen()
    const id = String(count++)
    lastId = id

    // record a settled result for waiters (echo)
    active.set(id, Promise.resolve(input))
    // If a custom runner is active, push input to its stdin
    if (child?.stdin) {
      const bytes = new TextEncoder().encode(String(input) + '\n')
      ;(async () => {
        try {
          const w = child!.stdin!.getWriter()
          await w.write(bytes)
          w.releaseLock()
        } catch (_) {
          // ignore write errors (process may have exited)
        }
      })()
    }
    // Start a single-use watcher for notify.json on first interaction after idle
    if (configDir && !pendingNotifyWatcher) {
      pendingNotifyWatcher = startNotifyWatcher(
        configDir,
        (raw) => {
          lastNotificationRaw = raw
          notifications += 1
        },
      ).finally(() => {
        pendingNotifyWatcher = null
      })
      pendingNotifyWatcher.catch(() => {
        // ignore
      })
    }
    return { id }
  }

  async function destroy() {
    closed = true
    if (child) {
      try {
        // Close stdin if we piped it (prevents test leak warning)
        try {
          if (child.stdin) {
            const w = child.stdin.getWriter()
            await w.close()
            w.releaseLock()
          }
        } catch (_) {
          // ignore
        }
        // Try graceful SIGTERM, then force kill after a short delay
        child.kill('SIGTERM')
      } catch (_) {
        // ignore
      }
    }
  }

  async function status() {
    await Promise.resolve()
    return {
      startedAt: startedAt.toISOString(),
      closed,
      interactions: count,
      lastInteractionId: lastId,
      pid,
      config: configDir,
      workspace: workspaceDir,
      notifications,
      lastNotificationRaw,
    }
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
    // TODO throw in an abort controller when its running so we can cancel it
    if (!rec) throw new Error(`unknown interaction id: ${id}`)
    active.delete(id)
    return Promise.resolve()
  }

  return { interaction, awaitInteraction, cancel, destroy, status }
}
