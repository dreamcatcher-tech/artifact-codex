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
    // TODO detect if the replay was because the machine we set as
    // prefer_instance is not available
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

    const changeCount = await reconcile(computerId)
    return c.json({ changeCount })
  })

  return app
}
