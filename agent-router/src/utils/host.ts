import { BASE_DOMAIN } from '../config.ts'

export type HostInfo = {
  host: string
  isBase: boolean
  appSubdomain: string | null
}

export const parseHost = (hostHeader?: string): HostInfo => {
  const host = (hostHeader ?? '').split(':')[0].toLowerCase()
  if (!host) return { host: '', isBase: true, appSubdomain: null }
  if (host === BASE_DOMAIN || host === `www.${BASE_DOMAIN}`) {
    return { host, isBase: true, appSubdomain: null }
  }
  if (host.endsWith(`.${BASE_DOMAIN}`)) {
    const sub = host.slice(0, -1 * (`.${BASE_DOMAIN}`).length)
    return { host, isBase: false, appSubdomain: sub }
  }
  // Unknown domain — treat as base to avoid leaking app behavior
  return { host, isBase: true, appSubdomain: null }
}
