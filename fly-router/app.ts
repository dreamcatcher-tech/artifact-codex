import { Hono, type HonoRequest } from '@hono/hono'

export const createApp = () => {
  const app = new Hono()

  app.get('/', (c) => {
    return c.text('Hello, world!')
  })

  return app
}
