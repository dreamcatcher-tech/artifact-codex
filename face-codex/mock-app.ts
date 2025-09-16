#!/usr/bin/env -S deno run

// A tiny mock runner that reads a single line from stdin and
// invokes the notify app with an AgentTurnComplete payload.

function parseArgs(args: string[]) {
  let notify = ''
  let dir = ''
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--notify') notify = String(args[++i] ?? '')
    else if (a === '--dir') dir = String(args[++i] ?? '')
    else if (a.startsWith('--notify=')) notify = a.slice(9)
    else if (a.startsWith('--dir=')) dir = a.slice(6)
  }
  return { notify, dir }
}

async function readOneLine(): Promise<string | null> {
  const reader = Deno.stdin.readable.getReader()
  const decoder = new TextDecoder()
  try {
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const idx = buf.indexOf('\n')
      if (idx >= 0) {
        const line = buf.slice(0, idx)
        return line
      }
    }
    return buf.length > 0 ? buf : null
  } finally {
    reader.releaseLock()
  }
}

if (import.meta.main) {
  const { notify, dir } = parseArgs(Deno.args)
  if (!notify || !dir) {
    console.error(
      'Usage: mock-app --notify <path/to/notify.ts> --dir <configDir>',
    )
    Deno.exit(1)
  }
  const line = await readOneLine()
  const msg = String(line ?? '').trim()
  const payload = JSON.stringify({
    type: 'agent-turn-complete',
    'turn-id': 'mock-' + crypto.randomUUID(),
    'input-messages': [msg],
    'last-assistant-message': `done: ${msg}`,
  })

  const cmd = new Deno.Command('deno', {
    args: ['run', `--allow-write=${dir}`, notify, '--dir', dir, payload],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const out = await cmd.output()
  Deno.exit(out.code)
}
