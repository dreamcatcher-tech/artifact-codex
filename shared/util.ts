import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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

// Lazy env getter to avoid crashing if --allow-env omitted
export function getEnv(name: string): string | undefined {
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
