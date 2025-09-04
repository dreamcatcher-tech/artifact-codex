import { load } from '@std/dotenv'

// Loads environment variables from the shared .env file that is
// written by shared/pre.ts. Safe if the file is missing.
// When exportToEnv is true, values are exported to Deno.env (without
// overriding existing variables), matching std/dotenv semantics.
export async function loadEnvFromShared(
  opts: { exportToEnv?: boolean; path?: string | URL } = {},
): Promise<Record<string, string>> {
  const exportToEnv = opts.exportToEnv ?? true
  const envPath = (() => {
    if (opts.path) {
      return typeof opts.path === 'string' ? opts.path : opts.path.pathname
    }
    // Default to the .env next to this file (i.e., shared/.env)
    return new URL('./.env', import.meta.url).pathname
  })()

  try {
    const env = await load({ envPath, export: exportToEnv })
    return env
  } catch (_err) {
    // If missing or unreadable, act as a no-op
    return {}
  }
}
