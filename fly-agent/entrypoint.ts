import { ensureNfsMount } from '@artifact/procman/mount.ts'

function parsePositiveInt(value: string | undefined, fallback: number): number {
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
  const mountEnabled = Deno.env.get('FLY_NFS_ENABLE_MOUNT') ?? '1'
  const retries = parsePositiveInt(Deno.env.get('FLY_NFS_RETRIES'), 5)
  const delaySeconds = parsePositiveInt(
    Deno.env.get('FLY_NFS_RETRY_DELAY_SEC'),
    3,
  )

  if (mountEnabled === '1') {
    await ensureNfsMount({
      retries,
      delayMs: delaySeconds * 1_000,
      logger: (msg) => console.error(`[entrypoint] ${msg}`),
      logPrefix: '',
    })
  } else {
    console.error(
      '[entrypoint] NFS mount disabled via FLY_NFS_ENABLE_MOUNT',
    )
  }

  if (Deno.args.length > 0) {
    await launchProcess(Deno.args[0]!, Deno.args.slice(1))
  }

  await launchProcess('deno', ['run', '-A', '/agent/web-server/main.ts'])
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[entrypoint] ${message}`)
    Deno.exit(1)
  })
}
