import Debug from 'debug'
import {
  COMPUTER_AGENT_CONTAINERS,
  NFS_MOUNT_DIR,
  readFlyMachineRuntimeEnv,
} from '@artifact/shared'
import { basename, fromFileUrl, join } from '@std/path'
import { mountNfs } from './startup.ts'

const log = Debug('@artifact/agent-basic')

const agentFolderName = () => {
  const dirPath = fromFileUrl(new URL('.', import.meta.url))
  const name = basename(dirPath)
  if (!name) {
    throw new Error('Unable to determine agent folder name')
  }
  return name
}

async function writeImageRecord(): Promise<void> {
  const { FLY_IMAGE_REF } = readFlyMachineRuntimeEnv()
  const containersDir = join(NFS_MOUNT_DIR, COMPUTER_AGENT_CONTAINERS)
  await Deno.mkdir(containersDir, { recursive: true })
  const recordPath = join(containersDir, `${agentFolderName}.json`)
  const payload = JSON.stringify({ image: FLY_IMAGE_REF }, null, 2)
  await Deno.writeTextFile(recordPath, payload)
  log('wrote image record path=%s', recordPath)
}

async function main(): Promise<void> {
  Debug.enable('@artifact/*')
  await mountNfs()
  await writeImageRecord()
  log('machine check complete')
}

if (import.meta.main) {
  main()
}
