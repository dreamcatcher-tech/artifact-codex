#!/usr/bin/env -S deno run -A

import { writeImageRecord } from '@artifact/fly-nfs'

if (import.meta.main) {
  await writeImageRecord(import.meta.url)
}
