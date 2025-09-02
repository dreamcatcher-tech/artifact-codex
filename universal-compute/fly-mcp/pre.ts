#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

// Dump current environment variables to fly-mcp/.env so the MCP server can
// read them later even in an isolated environment.

function serializeEnv(env: Record<string, string>): string {
  const keys = Object.keys(env).sort((a, b) => a.localeCompare(b))
  const out: string[] = []
  for (const key of keys) {
    // Only include keys that look like shell env names
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    const value = env[key] ?? ''

    // Quote if value contains characters that commonly break .env parsing
    const needsQuotes = /[\s#'"\\\n\r]/.test(value)
    if (needsQuotes) {
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/"/g, '\\"')
      out.push(`${key}="${escaped}` + `"`)
    } else {
      out.push(`${key}=${value}`)
    }
  }
  return out.join('\n') + '\n'
}

const target = new URL('./.env', import.meta.url) // fly-mcp/.env
const env = Deno.env.toObject()
const body = serializeEnv(env)
await Deno.writeTextFile(target, body)
