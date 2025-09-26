import Debug from 'debug'
import {
  COMPUTER_AGENT_CONTAINERS,
  NFS_MOUNT_DIR,
  readFlyMachineRuntimeEnv,
} from '@artifact/shared'
import { basename, fromFileUrl, join } from '@std/path'
import { mount } from './nfs-mount.ts'

const log = Debug('@artifact/fly-nfs:nfs-write-image-record')

const agentProjectName = () => {
  const dirPath = fromFileUrl(new URL('.', import.meta.url))
  const name = basename(dirPath)
  if (!name) {
    throw new Error('Unable to determine agent folder name')
  }
  return name
}

export async function writeImageRecord(): Promise<void> {
  const { FLY_IMAGE_REF } = readFlyMachineRuntimeEnv()
  const containersDir = join(NFS_MOUNT_DIR, COMPUTER_AGENT_CONTAINERS)
  // needs to make a full computer with all the fixings

  await Deno.mkdir(containersDir, { recursive: true })
  const name = agentProjectName()
  const recordPath = join(containersDir, `${name}.json`)
  const payload = JSON.stringify({ image: FLY_IMAGE_REF }, null, 2)
  await Deno.writeTextFile(recordPath, payload)
  log('wrote image record path=%s', recordPath)
}

async function main(): Promise<void> {
  Debug.enable('@artifact/*')
  await mount()
  await writeImageRecord()
  log('machine check complete')
}

if (import.meta.main) {
  main()
}
