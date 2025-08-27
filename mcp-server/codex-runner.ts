// Simple singleton manager for a long-lived `codex` process.
// - startCodex(): launches process and pipes stdout to a tmp log file
// - sendMessage(text): writes a line to the process stdin

export const LIVE_LOG_PATH = '/tmp/codex-live.log'

let child: Deno.ChildProcess | null = null
let stdoutPipe: Promise<void> | null = null

function isAlive() {
  return child !== null
}

export async function startCodex(): Promise<{ alreadyRunning: boolean; logPath: string }> {
  if (isAlive()) return { alreadyRunning: true, logPath: LIVE_LOG_PATH }

  // Ensure previous log is cleared
  await Deno.mkdir('/tmp', { recursive: true }).catch(() => {})
  const file = await Deno.open(LIVE_LOG_PATH, { create: true, write: true, truncate: true })

  const cmd = new Deno.Command('codex', {
    args: [],
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'inherit',
  })

  child = cmd.spawn()

  // Pipe stdout to the log file; close file when stream ends
  const writable = file.writable
  stdoutPipe = child.stdout?.pipeTo(writable).catch(() => {}) ?? Promise.resolve()

  // When the process exits, clear references safely
  ;(async () => {
    try {
      await child?.status
    } catch {
      // ignore
    } finally {
      child = null
      try {
        await stdoutPipe
      } catch {}
      stdoutPipe = null
    }
  })()

  return { alreadyRunning: false, logPath: LIVE_LOG_PATH }
}

export async function sendMessage(text: string): Promise<void> {
  if (!child || !child.stdin) {
    throw new Error('codex is not running; call start first')
  }
  const encoder = new TextEncoder()
  const writer = child.stdin.getWriter()
  try {
    await writer.write(encoder.encode(text + '\n'))
  } finally {
    writer.releaseLock()
  }
}

export function isRunning(): boolean {
  return isAlive()
}

