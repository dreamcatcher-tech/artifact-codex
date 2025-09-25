import { ensureNfsMount } from '@artifact/tasks'
import {
  FLY_NFS_MOUNT_DIR,
  FLY_NFS_SUBPATH,
  NFS_EXPORT_BASE,
} from '@artifact/shared'
import Debug from 'debug'

import { createAgentWebServer } from '@artifact/web-server'

import { createAgentDevSuiteOptions } from './server-options.ts'

const log = Debug('@artifact/agent-dev-suite:entrypoint')

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function launchProcess(command: string, args: string[]): Promise<never> {
  const child = new Deno.Command(command, {
    args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  const status = await child.status
  Deno.exit(status.code ?? 0)
}

async function main(): Promise<void> {
  Debug.enable('@artifact/*')
  log('starting entrypoint: args=%o', Deno.args)
  const mountEnabled = Deno.env.get('FLY_NFS_ENABLE_MOUNT') ?? '1'
  const retries = parsePositiveInt(Deno.env.get('FLY_NFS_RETRIES'), 5)
  const delaySeconds = parsePositiveInt(
    Deno.env.get('FLY_NFS_RETRY_DELAY_SEC'),
    3,
  )

  if (mountEnabled === '1') {
    const nfsApp = Deno.env.get('FLY_NFS_APP')?.trim()
    if (!nfsApp) {
      throw new Error('FLY_NFS_APP must be set for NFS mounting')
    }
    const nfsSource = `${nfsApp}.flycast`
    log(
      'mounting NFS share host=%s mountDir=%s subpath=%s',
      nfsSource,
      FLY_NFS_MOUNT_DIR,
      FLY_NFS_SUBPATH,
    )
    await ensureNfsMount({
      retries,
      delayMs: delaySeconds * 1_000,
      mountDir: FLY_NFS_MOUNT_DIR,
      exportBase: NFS_EXPORT_BASE,
      subpath: FLY_NFS_SUBPATH,
      source: nfsSource,
      logger: (msg) => console.error(`[entrypoint] ${msg}`),
      logPrefix: '',
    })
    log('mounted NFS share host=%s', nfsSource)
  } else {
    log('NFS mount disabled via FLY_NFS_ENABLE_MOUNT')
  }

  if (Deno.args.length > 0) {
    log(
      'delegating to provided command=%s args=%o',
      Deno.args[0],
      Deno.args.slice(1),
    )
    return await launchProcess(Deno.args[0]!, Deno.args.slice(1))
  }

  log('launching default agent-dev-suite web server')
  const options = createAgentDevSuiteOptions()
  const { app } = createAgentWebServer(options)
  const port = Number(Deno.env.get('PORT') ?? 8080)
  const hostname = '0.0.0.0'
  log('serving on %s:%d', hostname, port)
  Deno.serve({ port, hostname, reusePort: false }, app.fetch)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    log('fatal error: %s', message)
    Deno.exit(1)
  })
}
