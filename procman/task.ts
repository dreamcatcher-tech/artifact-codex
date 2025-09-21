import {
  CommandRunOptions,
  TaskExitEvent,
  TaskHandle,
  TaskOptions,
  TaskOutputEvent,
  TaskResult,
  TaskState,
  TaskStateEvent,
  TaskStdioOptions,
} from './types.ts'

const encoder = new TextEncoder()

type ResolvedStdio = Required<TaskStdioOptions>

const DEFAULT_STDIO: ResolvedStdio = {
  stdin: 'null',
  stdout: 'piped',
  stderr: 'piped',
}

async function ensureCommandAvailable(
  command: string,
  env?: Record<string, string>,
): Promise<string> {
  const resolved = await resolveCommand(command, env)
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

interface SpawnContext {
  child: Deno.ChildProcess
  stdoutPromise: Promise<string>
  stderrPromise: Promise<string>
  stdinWriter?: WritableStreamDefaultWriter<Uint8Array>
  startedAt: Date
  stdio: ResolvedStdio
}

export class TaskError extends Error {
  constructor(public readonly result: TaskResult) {
    const code = result.code === null ? 'unknown' : String(result.code)
    const signal = result.signal ?? 'none'
    super(`Task '${result.id}' failed (code=${code}, signal=${signal})`)
    this.name = 'TaskError'
  }
}

async function resolveCommand(
  command: string,
  env?: Record<string, string>,
): Promise<string | null> {
  const checkPathCandidate = async (path: string): Promise<string | null> => {
    try {
      const info = await Deno.stat(path)
      if (!info.isFile) return null
      if (info.mode == null || (info.mode & 0o111) !== 0) {
        return path
      }
    } catch {
      return null
    }
    return null
  }

  if (command.includes('/')) {
    return await checkPathCandidate(command)
  }

  const mergedEnv = { ...Deno.env.toObject(), ...(env ?? {}) }
  const which = new Deno.Command('which', {
    args: [command],
    env: mergedEnv,
    stdout: 'piped',
    stderr: 'null',
  })

  try {
    const output = await which.output()
    if (output.code !== 0) {
      return null
    }
    const text = new TextDecoder().decode(output.stdout).trim()
    return text.length > 0 ? await checkPathCandidate(text) : null
  } catch {
    return null
  }
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
      this.commandPath = await ensureCommandAvailable(
        this.options.command,
        this.options.env,
      )
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
      const context = await this.spawnOnce(false)
      const result = await this.waitForCompletion(context)
      last = result
      this.dispatchExit(result)
      if (result.success) {
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
    if (this.options.check && !last.success) {
      throw new TaskError(last)
    }
    return last
  }

  async start(): Promise<TaskHandle> {
    await this.validate()
    const context = await this.spawnOnce(true)
    const status = this.waitForCompletion(context).then((result) => {
      this.dispatchExit(result)
      if (this.options.check && !result.success) {
        throw new TaskError(result)
      }
      return result
    })
    return {
      id: this.id,
      pid: context.child.pid,
      status,
      stdin: context.stdinWriter,
      stop: (signal?: Deno.Signal) => this.stop(signal),
    }
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

  private async spawnOnce(keepStdinOpen: boolean): Promise<SpawnContext> {
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
    const stdio = this.resolveStdio()
    const command = new Deno.Command(this.commandPath, {
      args: this.options.args ?? [],
      cwd: this.options.cwd,
      env: this.options.env,
      stdin: stdio.stdin,
      stdout: stdio.stdout,
      stderr: stdio.stderr,
    })

    const child = command.spawn()
    this.child = child
    this.dispatchEvent(
      new CustomEvent('spawn', {
        detail: { id: this.id, pid: child.pid },
      }),
    )

    const stdoutPromise = stdio.stdout === 'piped'
      ? readStream(
        child.stdout,
        (chunk) => this.dispatchOutput('stdout', chunk),
      )
      : Promise.resolve('')
    const stderrPromise = stdio.stderr === 'piped'
      ? readStream(
        child.stderr,
        (chunk) => this.dispatchOutput('stderr', chunk),
      )
      : Promise.resolve('')

    let stdinWriter: WritableStreamDefaultWriter<Uint8Array> | undefined

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
    } else if (stdio.stdin === 'piped' && child.stdin) {
      const writer = child.stdin.getWriter()
      if (keepStdinOpen) {
        stdinWriter = writer
      } else {
        const closeError = await closeWriter(writer)
        if (closeError) {
          throw closeError
        }
      }
    }

    return {
      child,
      stdoutPromise,
      stderrPromise,
      stdinWriter,
      startedAt,
      stdio,
    }
  }

  private resolveStdio(): ResolvedStdio {
    const configured: TaskStdioOptions = this.options.stdio ?? {}
    const resolved: ResolvedStdio = {
      stdin: configured.stdin ?? DEFAULT_STDIO.stdin,
      stdout: configured.stdout ?? DEFAULT_STDIO.stdout,
      stderr: configured.stderr ?? DEFAULT_STDIO.stderr,
    }
    if (this.options.stdin !== undefined) {
      resolved.stdin = 'piped'
    }
    return resolved
  }

  private async waitForCompletion(context: SpawnContext): Promise<TaskResult> {
    const status = await context.child.status
    const endedAt = new Date()
    const stdout = await context.stdoutPromise.catch(() => '')
    const stderr = await context.stderrPromise.catch(() => '')
    if (context.stdinWriter) {
      await closeWriter(context.stdinWriter)
    }
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
      pid: context.child.pid,
      startedAt: context.startedAt,
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

export async function runCommand(
  options: CommandRunOptions,
): Promise<TaskResult> {
  const { id = crypto.randomUUID(), ...rest } = options
  const task = new Task({ id, ...rest })
  return await task.run()
}
