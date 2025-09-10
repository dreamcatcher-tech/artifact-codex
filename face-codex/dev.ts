#!/usr/bin/env -S deno run -A
import { dirname, fromFileUrl, join } from '@std/path'
import { startFaceCodex } from './main.ts'

function repoRootFromHere(): string {
  const here = dirname(fromFileUrl(import.meta.url)) // face-codex
  return dirname(here) // repo root
}

async function ensureDir(dir: string) {
  try {
    const st = await Deno.stat(dir)
    if (!st.isDirectory) throw new Error(`not a directory: ${dir}`)
  } catch {
    await Deno.mkdir(dir, { recursive: true })
  }
}

async function waitForHttp(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const intervalMs = opts.intervalMs ?? 400
  const start = Date.now()
  // Use HEAD first; some servers may not support it → fall back to GET
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      if (r.ok || r.status >= 200) return
    } catch (_) {
      // ignore and retry
    }
    try {
      const r = await fetch(url, { method: 'GET' })
      if (r.ok || r.status >= 200) return
    } catch (_) {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

async function openInBrowser(url: string) {
  const os = Deno.build.os
  try {
    if (os === 'darwin') {
      await new Deno.Command('open', { args: [url] }).output()
      return
    }
    if (os === 'windows') {
      await new Deno.Command('cmd', { args: ['/c', 'start', '', url] }).output()
      return
    }
    // linux and others
    await new Deno.Command('xdg-open', { args: [url] }).output()
  } catch {
    // Fall back to printing the URL if no opener is available
    console.log(`Open this URL in your browser: ${url}`)
  }
}

if (import.meta.main) {
  const root = repoRootFromHere()

  // Workspace for Codex to start in (default: repo root)
  const workspace = Deno.env.get('WORKSPACE') ?? root

  const home = await Deno.makeTempDir({ prefix: 'codex-dev-' })
  const port = Number(Deno.env.get('PORT') ?? '7681')

  await ensureDir(workspace)
  await ensureDir(home)

  // Launch the face, which spawns tmux + ttyd with AUTOSTART_CMD to run Codex.
  // startFaceCodex forwards current env (including PORT) to the child.
  const face = startFaceCodex({ workspace, home })

  const url = `http://localhost:${port}`
  console.log(
    `Starting Codex face with home at ${home}. Waiting for ttyd on ${url} ...`,
  )
  await waitForHttp(url, { timeoutMs: 25_000, intervalMs: 500 })

  // Try to open the browser to the ttyd server.
  await openInBrowser(url)
  console.log(`ttyd ready on ${url}`)
  console.log('Press Ctrl+C to stop.')

  // Keep the process running so the child keeps its parent and logs stream here.
  // If the child exits, we simply idle until user stops the task.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  await new Promise(() => {})

  // On termination, attempt to shut down the face gracefully.
  await face.destroy()
}
