#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { proxy } from '@hono/hono/proxy'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'

export function createApp() {
  const app = new Hono()
  const mcp = mcpHandler()
  app.use('*', async (c, next) => {
    console.log('request', c.req.raw)
    const url = new URL(c.req.url)
    const cookie = c.req.header('cookie') ?? ''
    const hasTargetCookie = cookie.includes('__proxy_target=')

    if (url.searchParams.has('mcp')) {
      return await mcp.handler(c)
    }

    if (url.searchParams.has('port') || hasTargetCookie) {
      const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      if (isWS) return proxyWS(c.req.raw)
      return proxyHTTP(c.req.raw)
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
