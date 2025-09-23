import { runCommand } from '@artifact/procman'
import { resolveNfsSource } from '../shared/app_env.ts'
import { FLY_NFS_MOUNT_DIR, NFS_EXPORT_BASE } from '../shared/consts.ts'
import type { CommandExecutor, EnsureMountOptions } from './types.ts'

const DEFAULT_RETRIES = 5
const DEFAULT_DELAY_MS = 3_000
const DEFAULT_MOUNT_DIR = FLY_NFS_MOUNT_DIR
const DEFAULT_EXPORT_BASE = NFS_EXPORT_BASE
const DEFAULT_MOUNT_OPTS = 'nfsvers=4.1'

interface MountContext {
  env: Record<string, string>
  mountDir: string
  exportPath: string
  mountOpts: string
  source: string
  logger: (message: string) => void
  logPrefix: string
  commandExecutor: CommandExecutor
  validateBinaries: boolean
  validatePrivileges: boolean
}

function log(
  logger: (message: string) => void,
  prefix: string,
  message: string,
): void {
  logger(`${prefix} ${message}`.trim())
}

function normalizePath(path: string): string {
  if (!path) return '/'
  let normalized = path
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  normalized = normalized.replace(/\/+/g, '/').trim()
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized || '/'
}

function joinRelative(base: string, rel?: string): string {
  if (!rel || rel.length === 0) return normalizePath(base)
  if (rel.startsWith('/')) return normalizePath(rel)
  return normalizePath(`${base.replace(/\/$/, '')}/${rel}`)
}

function formatSpec(host: string, exportPath: string): string {
  const trimmed = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host
  const needsBrackets = trimmed.includes(':') && !trimmed.includes('.')
  const specHost = needsBrackets ? `[${trimmed}]` : trimmed
  return `${specHost}:${exportPath}`
}

async function ensurePathExecutable(path: string): Promise<void> {
  const info = await Deno.stat(path).catch(() => null)
  if (!info?.isFile) {
    throw new Error(`Command not found: ${path}`)
  }
  if (info.mode != null && (info.mode & 0o111) === 0) {
    throw new Error(`Command is not executable: ${path}`)
  }
}

async function ensureCommandAvailable(
  command: string,
  env: Record<string, string>,
): Promise<void> {
  if (command.includes('/')) {
    await ensurePathExecutable(command)
    return
  }

  const merged = { ...Deno.env.toObject(), ...env }
  const proc = new Deno.Command('which', {
    args: [command],
    env: merged,
    stdout: 'null',
    stderr: 'null',
  })
  const result = await proc.output().catch(() => ({ code: 1 }))
  if (result.code !== 0) {
    throw new Error(`Command not found: ${command}`)
  }
}

async function ensureMountBinary(env: Record<string, string>): Promise<void> {
  try {
    await ensureCommandAvailable('mount.nfs', env)
  } catch {
    await ensureCommandAvailable('mount.nfs4', env)
  }
}

async function mountOnce(ctx: MountContext): Promise<void> {
  const {
    env,
    mountDir,
    exportPath,
    mountOpts,
    source,
    logger,
    logPrefix,
    commandExecutor,
    validateBinaries,
    validatePrivileges,
  } = ctx

  if (validateBinaries) {
    await ensureCommandAvailable('mount', env)
    await ensureMountBinary(env)
    await ensureCommandAvailable('mountpoint', env)
  }

  if (validatePrivileges) {
    const uid = typeof Deno.uid === 'function' ? Deno.uid() : null
    if (uid !== 0) {
      throw new Error('mount requires root privileges')
    }
  }

  await Deno.mkdir(mountDir, { recursive: true })

  const spec = formatSpec(source, exportPath)
  const mountpointArgs = ['-q', mountDir]

  const preCheck = await commandExecutor({
    command: 'mountpoint',
    args: mountpointArgs,
    env,
    stdio: { stdout: 'null', stderr: 'null' },
    check: false,
  })
  if (preCheck.success) {
    log(logger, logPrefix, `${mountDir} already mounted`)
    return
  }

  log(
    logger,
    logPrefix,
    `mounting ${spec} -> ${mountDir} with opts ${mountOpts}`,
  )

  await commandExecutor({
    command: 'mount',
    args: ['-t', 'nfs4', '-o', mountOpts, spec, mountDir],
    env,
    stdio: { stdout: 'inherit', stderr: 'inherit' },
    check: true,
  })

  const verify = await commandExecutor({
    command: 'mountpoint',
    args: mountpointArgs,
    env,
    stdio: { stdout: 'null', stderr: 'inherit' },
    check: false,
  })
  if (!verify.success) {
    throw new Error(`mount verification failed for ${mountDir}`)
  }

  log(logger, logPrefix, 'NFS mount ready')
}

export async function ensureNfsMount(
  options: EnsureMountOptions = {},
): Promise<void> {
  const env = { ...Deno.env.toObject(), ...(options.env ?? {}) }
  const mountDir = options.mountDir ?? env.FLY_NFS_MOUNT_DIR ??
    DEFAULT_MOUNT_DIR
  const exportBase = normalizePath(
    options.exportBase ?? DEFAULT_EXPORT_BASE,
  )
  const subpath = options.subpath ?? env.FLY_NFS_SUBPATH ?? ''
  const exportPath = joinRelative(exportBase, subpath)
  const mountOpts = options.mountOpts ?? env.FLY_NFS_MOUNT_OPTS ??
    DEFAULT_MOUNT_OPTS
  const source = resolveNfsSource(env, {
    source: options.source,
  })

  const logger = options.logger ?? ((message: string) => console.error(message))
  const logPrefix = options.logPrefix ?? '[procman:nfs]'
  const commandExecutor = options.commandExecutor ?? runCommand
  const validateBinaries = options.validateBinaries ?? true
  const validatePrivileges = options.validatePrivileges ?? true

  const retries = options.retries ?? DEFAULT_RETRIES
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS

  let attempt = 0
  let finalError: unknown

  while (attempt < retries) {
    attempt += 1
    try {
      await mountOnce({
        env,
        mountDir,
        exportPath,
        mountOpts,
        source,
        logger,
        logPrefix,
        commandExecutor,
        validateBinaries: validateBinaries && attempt === 1,
        validatePrivileges,
      })
      return
    } catch (error) {
      finalError = error
      const message = `mount attempt ${attempt} failed (${
        error instanceof Error ? error.message : String(error)
      })`
      if (attempt >= retries) {
        log(logger, logPrefix, message)
        break
      }
      log(
        logger,
        logPrefix,
        `${message}; retrying in ${Math.round(delayMs / 1000)}s`,
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  log(
    logger,
    logPrefix,
    `Failed to mount NFS after ${retries} attempt${retries === 1 ? '' : 's'}`,
  )

  if (finalError) {
    throw finalError
  }
  throw new Error('Failed to mount NFS and no error details were captured')
}
