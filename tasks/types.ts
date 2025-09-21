export interface CommandRunOptions {
  command: string
  args?: string[]
  env?: Record<string, string>
  stdin?: string | string[]
  stdout?: 'inherit' | 'piped' | 'null'
  stderr?: 'inherit' | 'piped' | 'null'
  check?: boolean
}

export interface CommandResult {
  success: boolean
  code: number | null
  signal: Deno.Signal | null
  stdout: string
  stderr: string
}

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

export type CommandExecutor = (
  options: CommandRunOptions,
) => Promise<CommandResult>
