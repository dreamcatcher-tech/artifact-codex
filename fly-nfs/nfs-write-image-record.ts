#!/usr/bin/env -S deno run -A

import { ensureDir } from '@std/fs'
import Debug from 'debug'
import { createComputerManager } from '@artifact/fly-router'
import { ImageRecord, imageRecordSchema } from './schemas.ts'
import {
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_REPOS,
  NFS_MOUNT_DIR,
  readFlyEnv,
  REPO_CONTAINER_IMAGES,
} from '@artifact/shared'
import { join } from '@std/path'
import { mount } from './nfs-mount.ts'

const log = Debug('@artifact/fly-nfs:nfs-write-image-record')

export async function writeImageRecord(
  name: string,
  record: Omit<ImageRecord, 'image'>,
): Promise<void> {
  Debug.enable('@artifact/*')
  await mount(log, 'sync')
  const computerManager = createComputerManager({ computerDir: NFS_MOUNT_DIR })
  await computerManager.upsertComputer(COMPUTER_AGENT_CONTAINERS)

  const containersDir = join(
    NFS_MOUNT_DIR,
    COMPUTER_AGENT_CONTAINERS,
    COMPUTER_REPOS,
    REPO_CONTAINER_IMAGES,
  )
  await ensureDir(containersDir)

  const recordPath = join(containersDir, `${name}.json`)

  const { FLY_IMAGE_REF } = readFlyEnv()
  const validated = imageRecordSchema.parse({ image: FLY_IMAGE_REF, ...record })
  const payload = JSON.stringify(validated, null, 2)
  await Deno.writeTextFile(recordPath, payload)
  log('wrote image record path=%s %o', recordPath, validated)
}

export async function readImageRecord(
  recordPath: string,
): Promise<ImageRecord> {
  const text = await Deno.readTextFile(recordPath)
  return imageRecordSchema.parse(JSON.parse(text))
}
