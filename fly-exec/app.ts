import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { createReconciler } from './reconcile.ts'
import { envs } from '@artifact/shared'

export const createApp = () => {
  const app = new Hono()
  const { reconcile } = createReconciler()

  app.use('*', logger())

  app.all('*', async (c, next) => {
    const replayedFrom = c.req.header('fly-replay-src')
    if (!replayedFrom) {
      return await next()
    }
    console.log('replayed from:', replayedFrom)

    const res = c.body(null, 204)
    res.headers.set('fly-replay', `app=${envs.DC_ROUTER()}`)
    console.log('replay response:', res)
    return res
  })

  app.post('changed/:computerId', async (c) => {
    const computerId = c.req.param('computerId')

    const changeCount = await reconcile(computerId)
    return c.json({ changeCount })
  })

  return app
}
