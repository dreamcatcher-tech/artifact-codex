export type TaskState =
  | 'pending'
  | 'validated'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface RestartPolicy {
  attempts: number
  delayMs?: number
}

export type StdioMode = 'inherit' | 'piped' | 'null'

export interface TaskStdioOptions {
  stdin?: StdioMode
  stdout?: StdioMode
  stderr?: StdioMode
}

export interface TaskOptions {
  id: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: string | string[]
  restart?: RestartPolicy
  ports?: number[]
  stdio?: TaskStdioOptions
  stopSignal?: Deno.Signal
  check?: boolean
}

export interface TaskResult {
  id: string
  state: TaskState
  success: boolean
  code: number | null
  signal: Deno.Signal | null
  stdout: string
  stderr: string
  pid: number | null
  startedAt: Date
  endedAt: Date
  attempts: number
}

export interface TaskHandle {
  id: string
  pid: number
  status: Promise<TaskResult>
  stdin?: WritableStreamDefaultWriter<Uint8Array>
  stop: (signal?: Deno.Signal) => void
}

export interface CommandRunOptions extends Omit<TaskOptions, 'id'> {
  id?: string
}

export type CommandExecutor = (
  options: CommandRunOptions,
) => Promise<TaskResult>

export interface WorkflowOptions {
  stopOnError?: boolean
}

export interface WorkflowResult {
  success: boolean
  results: TaskResult[]
}

export interface TaskStateEvent {
  id: string
  state: TaskState
}

export interface TaskOutputEvent {
  id: string
  stream: 'stdout' | 'stderr'
  chunk: string
}

export interface TaskExitEvent {
  id: string
  result: TaskResult
}
