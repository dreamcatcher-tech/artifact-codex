import { runSelfMountCheck } from '@artifact/procman/self_mount_check.ts'

async function main() {
  await runSelfMountCheck()
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    Deno.exit(1)
  })
}
