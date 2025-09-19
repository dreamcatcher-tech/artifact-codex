import { type Context, Hono } from '@hono/hono'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'

type CreateAppOptions = {
  redirectUrl?: string
}

type ClerkRedirects = {
  signIn?: string
  signUp?: string
}

const DEFAULT_REDIRECT_URL = 'https://dreamcatcher.land'
export function createApp(
  { redirectUrl = DEFAULT_REDIRECT_URL }: CreateAppOptions = {},
) {
  const app = new Hono<{ Variables: ClerkAuthVariables }>()

  app.use('*', clerkMiddleware())

  app.get('/', (c) => {
    const auth = getAuth(c)
    if (!auth?.userId) {
      const redirects = resolveClerkRedirects()
      if (wantsJson(c)) {
        return c.json({ error: 'unauthenticated' }, 401)
      }

      const destination = resolveRedirectUrl(c, redirects)
      if (!destination) {
        return c.json({ error: 'unauthenticated' }, 401)
      }

      return c.redirect(destination, 302)
    }

    return c.redirect(redirectUrl, 302)
  })

  return app
}

export type { CreateAppOptions }
export { DEFAULT_REDIRECT_URL }

function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept')?.toLowerCase() ?? ''
  if (!accept) return false
  return accept.includes('application/json') || accept.includes('text/json')
}

function resolveRedirectUrl(
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

function appendRedirectBack(target: string, requestUrl: string): string {
  try {
    const next = new URL(target)
    const back = new URL(requestUrl)
    const params = new URLSearchParams(next.search)
    params.set('redirect_url', back.toString())
    next.search = params.toString()
    return next.toString()
  } catch {
    return target
  }
}

function resolveClerkRedirects(): ClerkRedirects {
  const envSignIn = readUrlFromEnv('CLERK_SIGN_IN_URL')
  const envSignUp = readUrlFromEnv('CLERK_SIGN_UP_URL')
  if (envSignIn || envSignUp) {
    return { signIn: envSignIn, signUp: envSignUp }
  }

  const base = deriveFrontendBaseUrl(
    Deno.env.get('CLERK_PUBLISHABLE_KEY') ?? '',
  )
  if (!base) return {}

  const normalized = ensureHttpScheme(base)
  return {
    signIn: joinUrl(normalized, '/sign-in'),
    signUp: joinUrl(normalized, '/sign-up'),
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

function deriveFrontendBaseUrl(publishableKey: string): string | undefined {
  const key = publishableKey.trim()
  if (!key) return undefined
  const parts = key.split('_')
  if (parts.length < 3) return undefined
  const encoded = parts.slice(2).join('_')
  const padLength = (4 - (encoded.length % 4)) % 4
  const padded = encoded + '='.repeat(padLength)
  try {
    const decoded = atob(padded)
      .replaceAll('\0', '')
      .replaceAll('$', '')
      .trim()
    return decoded || undefined
  } catch {
    return undefined
  }
}

function ensureHttpScheme(candidate: string): string {
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return candidate
  }
  return `https://${candidate}`
}

function joinUrl(base: string, path: string): string {
  try {
    const url = new URL(base)
    url.pathname = path
    return url.toString()
  } catch {
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
    return `${trimmed}${path}`
  }
}
