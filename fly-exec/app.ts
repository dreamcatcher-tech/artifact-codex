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
    // TODO detect if the replay was because the machine was not available
    // use the fly-preferred-instance-unavailable header to detect this

    // if (!replayedFrom) {
    return await next()
    // }
    // console.log('replayed from:', replayedFrom)

    // const res = c.body(null, 204)
    // const appName = envs.DC_ROUTER().slice(0, -'.flycast'.length)
    // res.headers.set('fly-replay', `app=${appName}`)
    // console.log('replay response:', res)
    // return res
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
