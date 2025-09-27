#!/usr/bin/env -S deno run -A

import { ensureDir } from '@std/fs'
import Debug from 'debug'
import { createComputerManager } from '@artifact/fly-router'
import {
  COMPUTER_AGENT_CONTAINERS,
  COMPUTER_REPOS,
  NFS_MOUNT_DIR,
  readFlyMachineRuntimeEnv,
  REPO_CONTAINER_IMAGES,
} from '@artifact/shared'
import { basename, fromFileUrl, join } from '@std/path'
import { mount } from './nfs-mount.ts'

const log = Debug('@artifact/fly-nfs:nfs-write-image-record')

const agentProjectName = (moduleUrl: string) => {
  const dirPath = fromFileUrl(new URL('.', moduleUrl))
  const name = basename(dirPath)
  if (!name) {
    throw new Error('Unable to determine agent folder name')
  }
  return name
}

export async function writeImageRecord(importMetaUrl: string): Promise<void> {
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

  const name = agentProjectName(importMetaUrl)
  const recordPath = join(containersDir, `${name}.json`)

  const { FLY_IMAGE_REF } = readFlyMachineRuntimeEnv()
  const payload = JSON.stringify({ image: FLY_IMAGE_REF }, null, 2)
  await Deno.writeTextFile(recordPath, payload)
  log('wrote image record path=%s', recordPath)
}
