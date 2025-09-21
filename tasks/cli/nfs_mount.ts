#!/usr/bin/env -S deno run -A

import { ensureNfsMount } from '../mod.ts'
import type { EnsureMountOptions } from '../types.ts'

interface ParsedArgs {
  subpath?: string
  options: EnsureMountOptions
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: EnsureMountOptions = {}
  let subpath: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--subpath':
        subpath = argv[++i]
        break
      case '--mount-dir':
        options.mountDir = argv[++i]
        break
      case '--export-base':
        options.exportBase = argv[++i]
        break
      case '--mount-opts':
        options.mountOpts = argv[++i]
        break
      case '--source':
        options.source = argv[++i]
        break
      case '--host':
        options.host = argv[++i]
        break
      case '--app':
        options.app = argv[++i]
        break
      case '--retries':
        options.retries = Number.parseInt(argv[++i], 10)
        break
      case '--delay-ms':
        options.delayMs = Number.parseInt(argv[++i], 10)
        break
      case '--no-validate-binaries':
        options.validateBinaries = false
        break
      case '--no-validate-privileges':
        options.validatePrivileges = false
        break
      case '--env': {
        const kv = argv[++i]
        const [key, value] = (kv ?? '').split('=')
        if (!options.env) options.env = {}
        if (key) options.env[key] = value ?? ''
        break
      }
      default:
        if (!subpath && !arg.startsWith('-')) {
          subpath = arg
        } else {
          throw new Error(`Unknown argument: ${arg}`)
        }
    }
  }

  if (!options.env) options.env = {}
  return { subpath, options }
}

async function main() {
  const { subpath, options } = parseArgs(Deno.args.slice())
  if (subpath) options.subpath = subpath
  await ensureNfsMount(options)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    Deno.exit(1)
  })
}
