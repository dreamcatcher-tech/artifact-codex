#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'

function _parsePort(v: string | null): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

export function createApp() {
  const app = new Hono()
  const mcp = mcpHandler()
  app.use('*', async (c, next) => {
    console.log('request', c.req.raw)
    const url = new URL(c.req.url)
    const hasFlyHeader = !!(
      c.req.raw.headers.get('fly-forwarded-port') ??
        c.req.header('fly-forwarded-port') ?? null
    )

    if (url.searchParams.has('mcp')) {
      return await mcp.handler(c)
    }

    if (hasFlyHeader) {
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
