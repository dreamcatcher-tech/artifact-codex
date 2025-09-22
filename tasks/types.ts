import type {
  CommandExecutor as ProcmanCommandExecutor,
  CommandRunOptions as ProcmanCommandRunOptions,
  TaskResult,
} from '@artifact/procman'

export type CommandExecutor = ProcmanCommandExecutor
export type CommandRunOptions = ProcmanCommandRunOptions
export type CommandResult = TaskResult

export interface EnsureMountOptions {
  env?: Record<string, string>
  subpath?: string
  mountDir?: string
  exportBase?: string
  mountOpts?: string
  source?: string
  host?: string
  app?: string
  retries?: number
  delayMs?: number
  logger?: (message: string) => void
  logPrefix?: string
  commandExecutor?: CommandExecutor
  validateBinaries?: boolean
  validatePrivileges?: boolean
}

export interface SelfMountCheckOptions {
  env?: Record<string, string>
  logger?: (message: string) => void
  listCommand?: CommandRunOptions
  commandExecutor?: CommandExecutor
  mountOptions?: EnsureMountOptions
  subpath?: string
}
