#!/usr/bin/env -S deno run -A

import { writeImageRecord } from '@artifact/fly-nfs'

if (import.meta.main) {
  const name = Deno.args[0]
  if (!name) {
    throw new Error('Name is required')
  }
  await writeImageRecord(name, {
    cpu_kind: 'shared',
    cpus: 1,
    memory_mb: 256,
  })
}
