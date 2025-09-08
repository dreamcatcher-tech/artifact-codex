#!/usr/bin/env -S deno run
import { dirname, fromFileUrl, join } from '@std/path'
import { type Face, type StartFaceOptions } from '../shared/mod.ts'

/**
 * Start a lightweight in-memory "face" that echoes interactions and tracks status.
 */
export function startFaceCodex(opts: StartFaceOptions = {}): Face {
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
    }
  }

  return { interaction, close, status }
}

// When executed directly, provide a tiny demo: read a single arg and echo.
if (import.meta.main) {
  const face = startFaceCodex()
  const input = Deno.args[0] ?? ''
  try {
    const res = face.interaction(input)
    console.log(JSON.stringify(res))
  } finally {
    await face.close()
  }
}
