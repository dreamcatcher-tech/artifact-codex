import { join } from '@std/path/join'

import {
  TaskExitEvent,
  TaskOptions,
  TaskOutputEvent,
  TaskResult,
  TaskState,
  TaskStateEvent,
} from './types.ts'

const encoder = new TextEncoder()

async function ensureCommandAvailable(command: string): Promise<string> {
  const resolved = await resolveCommand(command)
  if (!resolved) {
    throw new Error(`Command not found: ${command}`)
  }
  return resolved
}

async function ensureDirectoryExists(path: string): Promise<void> {
  const info = await Deno.stat(path).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Directory not found: ${path}`)
    }
    throw error
  })
  if (!info.isDirectory) {
    throw new Error(`Expected directory but found something else: ${path}`)
  }
}

function ensurePortsAvailable(ports: number[]): void {
  for (const port of ports) {
    let listener: Deno.Listener | undefined
    try {
      listener = Deno.listen({ hostname: '127.0.0.1', port })
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`
      throw new Error(`Port ${port} is unavailable: ${message}`)
    } finally {
      listener?.close()
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function closeWriter(
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<unknown> {
  try {
    await writer.close()
    return undefined
  } catch (error) {
    if (error instanceof Deno.errors.BrokenPipe) {
      return undefined
    }
    return error
  }
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!stream) {
    return ''
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        const text = decoder.decode(value, { stream: true })
        if (text) {
          buffer += text
          onChunk(text)
        }
      }
    }
    const finalText = decoder.decode()
    if (finalText) {
      buffer += finalText
      onChunk(finalText)
    }
    return buffer
  } finally {
    reader.releaseLock()
  }
}

function ensureArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

async function resolveCommand(command: string): Promise<string | null> {
  const tryCandidate = async (candidate: string): Promise<string | null> => {
    try {
      const info = await Deno.stat(candidate)
      if (!info.isFile) {
        return null
      }
      const mode = info.mode
      if (mode == null || (mode & 0o111) !== 0) {
        return candidate
      }
    } catch {
      return null
    }
    return null
  }

  const hasPathSeparator = command.includes('/') || command.includes('\\')
  if (hasPathSeparator) {
    return await tryCandidate(command)
  }

  const pathEnv = Deno.env.get('PATH')
  if (!pathEnv) {
    return null
  }
  const separator = Deno.build.os === 'windows' ? ';' : ':'
  const extensions = Deno.build.os === 'windows'
    ? (Deno.env.get('PATHEXT') ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']

  for (const folder of pathEnv.split(separator)) {
    if (!folder) continue
    for (const ext of extensions) {
      const candidate = join(folder, command + ext)
      const resolved = await tryCandidate(candidate)
      if (resolved) {
        return resolved
      }
    }
  }
  return null
}

export class Task extends EventTarget {
  readonly id: string
  private readonly options: TaskOptions
  private state: TaskState = 'pending'
  private attempt = 0
  private commandPath?: string
  private child?: Deno.ChildProcess
  private stopRequested?: Deno.Signal
  private lastResult?: TaskResult

  constructor(options: TaskOptions) {
    super()
    this.id = options.id
    this.options = { ...options }
  }

  get status(): TaskState {
    return this.state
  }

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  get result(): TaskResult | undefined {
    return this.lastResult
  }

  async validate(): Promise<void> {
    if (this.state === 'running') {
      throw new Error(`Cannot validate task '${this.id}' while it is running`)
    }
    if (!this.commandPath) {
      this.commandPath = await ensureCommandAvailable(this.options.command)
    }
    if (this.options.cwd) {
      await ensureDirectoryExists(this.options.cwd)
    }
    if (this.options.ports?.length) {
      ensurePortsAvailable(this.options.ports)
    }
    this.updateState('validated')
  }

  async run(): Promise<TaskResult> {
    await this.validate()
    const maxAttempts = this.options.restart?.attempts ?? 1
    const delayMs = this.options.restart?.delayMs ?? 0
    let last: TaskResult | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.executeOnce()
      last = result
      if (result.success) {
        this.dispatchExit(result)
        return result
      }
      if (attempt + 1 < maxAttempts) {
        if (delayMs > 0) {
          await delay(delayMs)
        }
        this.updateState('validated')
      }
    }
    if (!last) {
      throw new Error('Task execution failed without producing a result')
    }
    this.dispatchExit(last)
    return last
  }

  stop(signal: Deno.Signal = this.options.stopSignal ?? 'SIGTERM'): void {
    if (!this.child) {
      return
    }
    this.stopRequested = signal
    try {
      this.child.kill(signal)
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error
      }
    }
  }

  async restart(): Promise<TaskResult> {
    this.stop()
    if (this.child) {
      await this.child.status.catch(() => {})
    }
    this.updateState('validated')
    return this.run()
  }

  private async executeOnce(): Promise<TaskResult> {
    if (!this.commandPath) {
      throw new Error('Task must be validated before running')
    }
    if (this.child) {
      throw new Error('Task already running')
    }
    this.stopRequested = undefined
    this.attempt += 1
    const startedAt = new Date()
    this.updateState('running')
    const captureOutput = !this.options.inheritStdio
    const command = new Deno.Command(this.commandPath, {
      args: this.options.args ?? [],
      cwd: this.options.cwd,
      env: this.options.env,
      stdin: this.options.stdin !== undefined
        ? 'piped'
        : this.options.inheritStdio
        ? 'inherit'
        : 'null',
      stdout: captureOutput ? 'piped' : 'inherit',
      stderr: captureOutput ? 'piped' : 'inherit',
    })

    const child = command.spawn()
    this.child = child
    this.dispatchEvent(
      new CustomEvent('spawn', {
        detail: { id: this.id, pid: child.pid },
      }),
    )

    const stdoutPromise = captureOutput
      ? readStream(
        child.stdout,
        (chunk) => this.dispatchOutput('stdout', chunk),
      )
      : Promise.resolve('')
    const stderrPromise = captureOutput
      ? readStream(
        child.stderr,
        (chunk) => this.dispatchOutput('stderr', chunk),
      )
      : Promise.resolve('')

    if (this.options.stdin !== undefined && child.stdin) {
      const writer = child.stdin.getWriter()
      let closeError: unknown
      try {
        const payloads = ensureArray(this.options.stdin)
        for (const payload of payloads) {
          await writer.write(encoder.encode(payload))
          if (Array.isArray(this.options.stdin)) {
            await writer.write(encoder.encode('\n'))
          }
        }
      } finally {
        closeError = await closeWriter(writer)
      }
      if (closeError) {
        throw closeError
      }
    }

    const status = await child.status
    const endedAt = new Date()
    const stdout = await stdoutPromise.catch(() => '')
    const stderr = await stderrPromise.catch(() => '')
    this.child = undefined

    const state = status.success
      ? 'succeeded'
      : status.signal && status.signal === this.stopRequested
      ? 'cancelled'
      : 'failed'

    this.updateState(state)

    const result: TaskResult = {
      id: this.id,
      state,
      success: status.success,
      code: status.code,
      signal: status.signal ?? null,
      stdout,
      stderr,
      pid: child.pid,
      startedAt,
      endedAt,
      attempts: this.attempt,
    }

    this.lastResult = result
    return result
  }

  private updateState(state: TaskState): void {
    if (this.state === state) {
      return
    }
    this.state = state
    const detail: TaskStateEvent = { id: this.id, state }
    this.dispatchEvent(new CustomEvent('state', { detail }))
  }

  private dispatchOutput(
    stream: TaskOutputEvent['stream'],
    chunk: string,
  ): void {
    const detail: TaskOutputEvent = { id: this.id, stream, chunk }
    this.dispatchEvent(new CustomEvent('output', { detail }))
    this.dispatchEvent(new CustomEvent(stream, { detail }))
  }

  private dispatchExit(result: TaskResult): void {
    const detail: TaskExitEvent = { id: this.id, result }
    this.dispatchEvent(new CustomEvent('exit', { detail }))
  }
}
