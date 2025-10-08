#!/usr/bin/env -S deno run -A

import { dirname, fromFileUrl } from '@std/path'
import { createCodexAgent } from './codex.ts'

async function main() {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) {
    console.error(
      'OPENAI_API_KEY environment variable is required for dev mode.',
    )
    Deno.exit(1)
  }

  const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)))
  const workspace = Deno.env.get('CODEX_DEV_WORKSPACE') ?? repoRoot
  const homeEnv = Deno.env.get('CODEX_DEV_HOME')
  console.log('homeEnv', homeEnv)
  const home = homeEnv ??
    await Deno.makeTempDir({ prefix: 'codex-dev-home-' })

  console.log('Workspace:', workspace)
  console.log('Home:', home)

  const agent = createCodexAgent({
    workspace,
    home,
    config: {
      env: { OPENAI_API_KEY: openaiKey },
      launch: 'tmux',
    },
  })

  const cleanupHome = !homeEnv
  try {
    const status = await agent.status()
    console.log('Codex agent ready.')
    if (status.views.length > 0) {
      for (const view of status.views) {
        console.log(`- ${view.name}: ${view.url}`)
      }
    } else {
      console.log('No views exposed (launch may be disabled).')
    }
    console.log('Press Ctrl+C to stop.')

    await waitForShutdown()
  } finally {
    try {
      await agent.destroy()
    } catch (err) {
      console.error('Error destroying agent:', err)
    }
    if (cleanupHome) {
      try {
        await Deno.remove(home, { recursive: true })
      } catch {
        // ignore
      }
    }
  }
}

async function waitForShutdown(): Promise<void> {
  const signals = ['SIGINT', 'SIGTERM'] as const
  await new Promise<void>((resolve) => {
    const handlers = new Map<(typeof signals)[number], () => void>()
    for (const signal of signals) {
      const handler = () => {
        for (const [sig, fn] of handlers) {
          Deno.removeSignalListener(sig, fn)
        }
        resolve()
      }
      handlers.set(signal, handler)
      Deno.addSignalListener(signal, handler)
    }
  })
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    Deno.exit(1)
  })
}
