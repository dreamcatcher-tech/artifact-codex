import { runCommand, TaskError } from './task.ts'
import type { CommandExecutor } from './types.ts'

const DEFAULT_RETRIES = 5
const DEFAULT_DELAY_MS = 3_000
const DEFAULT_COMMAND = '/usr/local/bin/mount-nfs.sh'

export interface EnsureMountOptions {
  command?: string
  args?: string[]
  env?: Record<string, string>
  retries?: number
  delayMs?: number
  logger?: (message: string) => void
  logPrefix?: string
  commandExecutor?: CommandExecutor
}

function log(
  logger: ((message: string) => void) | undefined,
  prefix: string,
  message: string,
): void {
  logger?.(`${prefix} ${message}`.trim())
}

export async function ensureNfsMount(
  options: EnsureMountOptions = {},
): Promise<void> {
  const {
    command = DEFAULT_COMMAND,
    args,
    env,
    retries = DEFAULT_RETRIES,
    delayMs = DEFAULT_DELAY_MS,
    logger,
    logPrefix = '[procman:nfs]',
    commandExecutor = runCommand,
  } = options

  let attempt = 0
  let lastResult: Awaited<ReturnType<CommandExecutor>> | undefined
  let lastError: unknown

  while (attempt < retries) {
    attempt += 1
    try {
      const result = await commandExecutor({
        command,
        args,
        env,
        stdio: { stdout: 'inherit', stderr: 'inherit' },
        check: false,
      })
      if (result.success) {
        log(logger, logPrefix, 'NFS mount ready')
        return
      }
      lastResult = result
      log(
        logger,
        logPrefix,
        `mount attempt ${attempt} failed (code ${result.code ?? 'unknown'})${
          attempt < retries
            ? `; retrying in ${Math.round(delayMs / 1000)}s`
            : ''
        }`,
      )
    } catch (error) {
      lastError = error
      log(
        logger,
        logPrefix,
        `mount attempt ${attempt} threw ${
          error instanceof Error ? error.message : String(error)
        }${
          attempt < retries
            ? `; retrying in ${Math.round(delayMs / 1000)}s`
            : ''
        }`,
      )
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  log(
    logger,
    logPrefix,
    `Failed to mount NFS after ${retries} attempt${retries === 1 ? '' : 's'}`,
  )

  if (lastResult) {
    throw new TaskError(lastResult)
  }
  if (lastError) {
    throw lastError
  }
  throw new Error('Failed to mount NFS and no result was captured')
}
