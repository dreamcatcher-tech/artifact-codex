#!/usr/bin/env -S deno run -A
import { createApp } from '@artifact/web-server'
import { startFaceInspector } from './main.ts'
import { dirname, fromFileUrl } from '@std/path'

function openBrowser(url: string) {
  const os = Deno.build.os
  const cmd = os === 'darwin'
    ? 'open'
    : os === 'windows'
    ? 'rundll32'
    : 'xdg-open'
  const args = os === 'windows' ? ['url.dll,FileProtocolHandler', url] : [url]
  try {
    const p = new Deno.Command(cmd, {
      args,
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    p.status.catch(() => {})
  } catch (_) {
    console.error('Failed to open browser. Visit:', url)
  }
}

async function main() {
  // 1) Launch streamable HTTP MCP server on :8080
  const { app } = createApp()
  Deno.serve({ hostname: '127.0.0.1', port: 8080 }, app.fetch)
  console.log(
    'MCP streamable HTTP server listening at http://127.0.0.1:8080/?mcp',
  )

  // 2) Launch Inspector face (gated by workspace+home)
  const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)))
  const workspace = repoRoot
  const home = await Deno.makeTempDir({ prefix: 'face-inspector-' })
  const face = startFaceInspector({ workspace, home })

  // 3) Poll status until UI port discovered, then open browser
  const started = Date.now()
  let opened = false
  while (Date.now() - started < 30_000) {
    const s = await face.status()
    const ui = s.ports?.ui
    const url = s.ports?.uiUrl || (ui ? `http://127.0.0.1:${ui}` : undefined)
    if (url && !opened) {
      console.log('Opening Inspector UI:', url)
      openBrowser(url)
      opened = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  console.log('Face Inspector dev running. Press Ctrl+C to exit.')
  // Keep process alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error(err)
  Deno.exit(1)
})
