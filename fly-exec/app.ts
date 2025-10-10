import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { createReconciler } from './reconcile.ts'
import { createQueue } from './queue.ts'

export const createApp = () => {
  const app = new Hono()
  const { reconcile } = createReconciler()
  const queue = createQueue<number>()

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

    const changeCount = await queue.enqueue(
      computerId,
      () => reconcile(computerId),
    )
    return c.json({ changeCount })
  })

  return app
}
