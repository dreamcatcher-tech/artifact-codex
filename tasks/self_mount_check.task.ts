#!/usr/bin/env -S deno run -A

import { runSelfMountCheck } from './mod.ts'
import type { EnsureMountOptions, SelfMountCheckOptions } from './types.ts'

interface ParsedArgs {
  options: SelfMountCheckOptions
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: SelfMountCheckOptions = {}
  const mountOptions: EnsureMountOptions = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--subpath':
        options.subpath = argv[++i]
        break
      case '--mount-dir':
        mountOptions.mountDir = argv[++i]
        break
      case '--export-base':
        mountOptions.exportBase = argv[++i]
        break
      case '--mount-opts':
        mountOptions.mountOpts = argv[++i]
        break
      case '--source':
        mountOptions.source = argv[++i]
        break
      case '--retries':
        mountOptions.retries = Number.parseInt(argv[++i], 10)
        break
      case '--delay-ms':
        mountOptions.delayMs = Number.parseInt(argv[++i], 10)
        break
      case '--no-validate-binaries':
        mountOptions.validateBinaries = false
        break
      case '--no-validate-privileges':
        mountOptions.validatePrivileges = false
        break
      case '--env': {
        const kv = argv[++i]
        const [key, value] = (kv ?? '').split('=')
        if (!options.env) options.env = {}
        if (key) options.env[key] = value ?? ''
        break
      }
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (Object.keys(mountOptions).length > 0) {
    options.mountOptions = mountOptions
  }
  return { options }
}

async function main() {
  const { options } = parseArgs(Deno.args.slice())
  await runSelfMountCheck(options)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    Deno.exit(1)
  })
}
