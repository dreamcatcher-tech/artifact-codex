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

export interface TaskOptions {
  id: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: string | string[]
  restart?: RestartPolicy
  ports?: number[]
  inheritStdio?: boolean
  stopSignal?: Deno.Signal
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
