import type { Context } from '@hono/hono'
import { agentToSubdomain, subdomainToAgent } from '@artifact/shared'

export type ClerkRedirects = {
  signIn?: string
  signUp?: string
}

export function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept')?.toLowerCase() ?? ''
  if (!accept) return false
  return accept.includes('application/json') || accept.includes('text/json')
}

export function resolveRedirectUrl(
  c: Context,
  redirects: ClerkRedirects,
): string | undefined {
  const { signIn, signUp } = redirects
  if (!signIn && !signUp) return undefined

  const search = new URL(c.req.url).searchParams
  const intent =
    (search.get('flow') ?? search.get('intent') ?? search.get('mode') ?? '')
      .toLowerCase()
  const wantsSignUp = intent === 'sign-up' || intent === 'signup'
  const base = wantsSignUp ? signUp ?? signIn : signIn ?? signUp
  if (!base) return undefined

  return appendRedirectBack(base, c.req.url)
}

export function resolveClerkRedirects(): ClerkRedirects {
  const envSignIn = readUrlFromEnv('CLERK_SIGN_IN_URL')
  const envSignUp = readUrlFromEnv('CLERK_SIGN_UP_URL')
  if (!envSignIn && !envSignUp) return {}
  return { signIn: envSignIn, signUp: envSignUp }
}

function appendRedirectBack(target: string, requestUrl: string): string {
  const sanitizedBack = normalizeRedirectBack(requestUrl)
  try {
    const next = new URL(target)
    const existing = next.search ? next.search.slice(1) : ''
    const redirectParam = `redirect_url=${sanitizedBack}`
    const query = existing ? `${existing}&${redirectParam}` : redirectParam
    const base = `${next.origin}${next.pathname}`
    return `${base}?${query}${next.hash ?? ''}`
  } catch {
    const separator = target.includes('?') ? '&' : '?'
    return `${target}${separator}redirect_url=${sanitizedBack}`
  }
}

function readUrlFromEnv(key: string): string | undefined {
  const raw = Deno.env.get(key)?.trim()
  if (!raw) return undefined
  try {
    return new URL(raw).toString()
  } catch {
    return undefined
  }
}

function normalizeRedirectBack(requestUrl: string): string {
  try {
    const url = new URL(requestUrl)
    const hostname = url.hostname
    if (!shouldSanitizeHostname(hostname)) return url.toString()
    const labels = hostname.split('.')
    if (labels.length === 0) return url.toString()
    labels[0] = agentToSubdomain(subdomainToAgent(labels[0]))
    url.hostname = labels.join('.')
    return url.toString()
  } catch {
    return requestUrl
  }
}

function shouldSanitizeHostname(hostname: string): boolean {
  if (!hostname) return false
  if (hostname.includes(':')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false
  return true
}
