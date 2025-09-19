import { Hono } from '@hono/hono'
import { clerkMiddleware, getAuth } from '@hono/clerk-auth'

type CreateAppOptions = {
  redirectUrl?: string
}

const DEFAULT_REDIRECT_URL = 'https://dreamcatcher.land'

export function createApp(
  { redirectUrl = DEFAULT_REDIRECT_URL }: CreateAppOptions = {},
) {
  const app = new Hono()

  app.use('*', clerkMiddleware())

  app.get('/', (c) => {
    const auth = getAuth(c)
    if (!auth?.userId) {
      return c.json({ error: 'unauthenticated' }, 401)
    }
    return c.redirect(redirectUrl, 302)
  })

  return app
}

export type { CreateAppOptions }
export { DEFAULT_REDIRECT_URL }
