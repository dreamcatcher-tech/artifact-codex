const env = (name: string, fallback?: string): string => {
  const v = Deno.env.get(name)
  if (v === undefined) return fallback ?? ''
  return v
}

export const BASE_DOMAIN = env('BASE_DOMAIN', 'dreamcatcher.ai')
export const DEFAULT_HOME_AGENT = env('DEFAULT_HOME_AGENT', 'home-agent')
export const ALLOW_ANY_APP = env('ALLOW_ANY_APP', 'true') === 'true'
export const ROUTER_VERSION = env('ROUTER_VERSION', '0.1.0')

export const isBaseHost = (host: string): boolean => {
  // exact match or Fly-internal host variants can be normalized upstream
  return host === BASE_DOMAIN || host.endsWith(`.${BASE_DOMAIN}`) === false
}
