import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { createReconciler, type ReconcilerOptions } from './reconcile.ts'

export const createApp = (options: ReconcilerOptions = {}) => {
  const app = new Hono()
  const { reconcile } = createReconciler(options)

  app.use('*', logger())

  app.all('*', async (c, next) => {
    const replayedFrom = c.req.header('fly-replay-src')
    if (replayedFrom) {
      console.log('replayed from:', replayedFrom)
    }

    return await next()
  })

  app.post('changed/:computerId', async (c) => {
    const computerId = c.req.param('computerId')
    const changeCount = await reconcile(computerId)
    return c.json({ changeCount })
  })

  return app
}
