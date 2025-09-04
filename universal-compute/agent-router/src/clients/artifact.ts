import type { AppResolution } from '../types.ts'
import { ALLOW_ANY_APP } from '../config.ts'

// Stub for Artifact MCP interactions
// - resolve_alias(host): return {app, status}
// - resolve_user_home(userId): return {host}

export const resolveAlias = async (host: string): Promise<AppResolution> => {
  const maintenance = host.startsWith('maint-')
  const invalid = host.startsWith('invalid-') || host.length === 0
  if (invalid) return { app: '', status: 'invalid' }
  const app = host.split('.')[0]
  if (!ALLOW_ANY_APP && app !== 'your-app') return { app: '', status: 'invalid' }
  return { app, status: maintenance ? 'maintenance' : 'ok' }
}

export const resolveUserHome = async (userId: string): Promise<{ host: string } | null> => {
  // Dev-only stub: allow overriding via header or env
  // In real impl, look up the user's home app via Artifact/Registry
  const forced = Deno.env.get('FORCE_HOME_APP')
  if (forced) return { host: `${forced}` }
  // Very basic: map user to "your-app"
  if (userId) return { host: 'your-app' }
  return null
}
