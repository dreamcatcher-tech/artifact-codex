import { Hono } from '@hono/hono'
import { reconcile } from './reconcile.ts'
import { envs } from '@artifact/shared'

export const createApp = () => {
  const app = new Hono()

  app.all('*', async (c, next) => {
    // if this is a fly replay request, do a replay back to the router app
    const routerApp = envs.DC_ROUTER()
    const routerUrl = `https://${routerApp}.flycast`
    const routerResponse = await fetch(routerUrl, {
      method: 'POST',
      body: c.req.raw,
    })
  })

  app.post('changed/:computerId', async (c) => {
    const computerId = c.req.param('computerId')

    const changeCount = await reconcile(computerId)
    return c.json({ changeCount })
  })

  return app
}
