#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import { type Face, type FaceOptions } from '../shared/mod.ts'

/**
 * Start a lightweight in-memory "face" that echoes interactions and tracks status.
 */
export function startFaceCodex(opts: FaceOptions = {}): Face {
  const startedAt = new Date()
  let closed = false
  let count = 0
  let lastId: string | undefined
  const idPrefix = 'fcx_'
  const transform = (s: string) => s

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
    if (!opts.workspace || !opts.config) return
    configDir = opts.config
    // Must not create directories; error if missing
    try {
      const st = await Deno.stat(configDir)
      if (!st.isDirectory) {
        throw new Error(`config is not a directory: ${configDir}`)
      }
    } catch {
      throw new Error(`config directory not found: ${configDir}`)
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
    // Launch only if both workspace and config are provided
    if (!opts.workspace || !opts.config) return
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

    const cmd = new Deno.Command('npx', {
      args: ['-y', 'openai/codex'],
      cwd: workspaceDir,
      env: { ...Deno.env.toObject(), CODEX_HOME: configDir! },
      stdin: 'inherit',
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
    return { id, value: transform(input) }
  }

  async function close() {
    closed = true
    if (child) {
      try {
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

  return { interaction, close, status }
}
