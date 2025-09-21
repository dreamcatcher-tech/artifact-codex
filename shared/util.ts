import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { FlyMachineRuntimeEnv } from './env.ts'
import { readFlyMachineRuntimeEnv } from './env.ts'

export function toStructured(
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(structuredContent, null, 2),
    }],
    structuredContent,
  }
}

export function toError(err: unknown): CallToolResult {
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: msg }], isError: true }
}

const flyRuntimeEnvKeys = [
  'FLY_APP_NAME',
  'FLY_MACHINE_ID',
  'FLY_ALLOC_ID',
  'FLY_REGION',
  'FLY_PUBLIC_IP',
  'FLY_IMAGE_REF',
  'FLY_MACHINE_VERSION',
  'FLY_PRIVATE_IP',
  'FLY_PROCESS_GROUP',
  'FLY_VM_MEMORY_MB',
  'PRIMARY_REGION',
] as const satisfies readonly (keyof FlyMachineRuntimeEnv)[]

const flyRuntimeEnvKeySet = new Set<string>(flyRuntimeEnvKeys)

// Lazy env getter to avoid crashing if --allow-env omitted
export function getEnv(name: string): string | undefined {
  if (flyRuntimeEnvKeySet.has(name)) {
    try {
      const bag = readFlyMachineRuntimeEnv()
      return bag[name as typeof flyRuntimeEnvKeys[number]]
    } catch {
      return undefined
    }
  }

  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

export function isValidFlyName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
}

/**
 * Returns a closure that tracks seen ids and throws if invoked with a
 * previously observed value.
 */
export function idCheck(label = 'id') {
  const seen = new Set<string>()
  return (id: string) => {
    if (seen.has(id)) {
      throw new Error(`duplicate ${label}: ${id}`)
    }
    seen.add(id)
  }
}
