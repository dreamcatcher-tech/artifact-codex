#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import type { Face, FaceOptions } from '@artifact/shared'

/**
 * Start a lightweight in-memory "face" that echoes interactions and tracks status.
 */
export function startFaceCodex(opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined
  const idPrefix = 'fcx_'
  const active = new Map<string, Promise<string>>()

  // Child process state (when opts.launch === true)
  let child: Deno.ChildProcess | undefined
  let childExited = false
  let exitCode: number | null = null
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

    const outPath = join(configDir, 'codex.config.toml')
    await Deno.writeTextFile(outPath, template)
  }

  async function maybeLaunch() {
    // Launch only if both workspace and home are provided
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

    // Build command: support custom runnerApp from opts.config; default to heavy app
    const configMap = opts.config as Record<string, unknown> | undefined
    const runnerApp = Array.isArray(configMap?.['runnerApp'])
      ? (configMap!['runnerApp'] as string[])
      : undefined
    const useCustom = Array.isArray(runnerApp) && runnerApp.length > 0
    let command = 'npx'
    let args: string[] = ['-y', 'openai/codex']
    if (useCustom) {
      command = runnerApp![0]
      args = runnerApp!.slice(1)
      // Provide notify script and config dir to mock runner
      const cfg = configDir!
      args = args.concat([
        '--notify',
        join(dirname(fromFileUrl(import.meta.url)), 'notify.ts'),
        '--dir',
        cfg,
      ])
    }

    const cmd = new Deno.Command(command, {
      args,
      cwd: workspaceDir,
      env: { ...Deno.env.toObject(), CODEX_HOME: configDir! },
      stdin: useCustom ? 'piped' : 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    child = cmd.spawn()
    pid = child.pid // Observe exit asynchronously
    ;(async () => {
      try {
        const status = await child!.status
        exitCode = status.code
      } catch (_) {
        exitCode = null
      } finally {
        childExited = true
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
    const id = idPrefix + crypto.randomUUID()
    lastId = id
    count += 1
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
      const filePath = join(configDir, 'notify.json')
      pendingNotifyWatcher = (async () => {
        const watcher = Deno.watchFs(configDir!)
        try {
          // Race: if file appeared between interaction call and watcher start
          let created = false
          try {
            const s = await Deno.stat(filePath)
            created = s.isFile
          } catch (_) {
            // not exists yet
          }
          if (created) {
            const raw = await Deno.readTextFile(filePath)
            lastNotificationRaw = raw
            notifications += 1
            try {
              await Deno.remove(filePath)
            } catch (_) {
              /* ignore */
            }
            return
          }
          for await (const ev of watcher) {
            if (
              (ev.kind === 'create' || ev.kind === 'modify') &&
              ev.paths.some((p) => p === filePath)
            ) {
              try {
                const raw = await Deno.readTextFile(filePath)
                lastNotificationRaw = raw
                notifications += 1
              } catch (_) {
                // try once more after a tiny delay in case of write timing
                await new Promise((r) => setTimeout(r, 10))
                try {
                  const raw = await Deno.readTextFile(filePath)
                  lastNotificationRaw = raw
                  notifications += 1
                } catch (_) {
                  // give up; keep silent
                }
              } finally {
                try {
                  await Deno.remove(filePath)
                } catch (_) {
                  /* ignore */
                }
              }
              break
            }
          }
        } finally {
          watcher.close()
          pendingNotifyWatcher = null
        }
      })()
      // fire-and-forget
      pendingNotifyWatcher.catch(() => {
        // swallow errors; status will not reflect an update
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
      const deadline = Date.now() + 3_000
      while (!childExited && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (!childExited) {
        try {
          child.kill('SIGKILL')
        } catch (_) {
          // ignore
        }
      }
    }
    await Promise.resolve()
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
      processExited: child ? childExited : undefined,
      exitCode: child ? exitCode : undefined,
      notifications,
      lastNotificationRaw,
    }
  }

  async function waitFor(id: string): Promise<string> {
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

  return { interaction, waitFor, cancel, destroy, status }
}
