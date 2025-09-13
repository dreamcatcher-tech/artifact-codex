#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'

export function createApp() {
  const app = new Hono()
  const mcp = mcpHandler()
  app.use('*', async (c, next) => {
    const port = c.req.header('fly-forwarded-port')
    if (port && port !== '443') {
      const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      if (isWS) return proxyWS(c.req.raw)
      return proxyHTTP(c.req.raw)
    }

    if (c.req.query('mcp') !== undefined) {
      return await mcp.handler(c)
    }

    return next()
  })

  // kind with no face, will trigger a new face, if that is permitted

  const close = () => {
    mcp.close()
  }

  return { app, close }
}

if (import.meta.main) {
  const port = Number(Deno.env.get('PORT') ?? 8080)
  const { app } = createApp()
  Deno.serve({ port }, app.fetch)
}
