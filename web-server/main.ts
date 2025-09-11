#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'

export function createApp() {
  const app = new Hono()
  const mcp = mcpHandler()
  // Treat MCP as a URL flag: any request with `?mcp` hits the MCP handler.
  app.all('*', (c, next) => {
    const url = new URL(c.req.url)
    if (url.searchParams.has('mcp')) {
      return mcp.handler(c)
    }
    return next()
  })

  const close = () => {
    mcp.close()
  }

  return { app, close }
}

if (import.meta.main) {
  const port = Number(Deno.env.get('PORT') ?? '8080')
  const { app } = createApp()
  Deno.serve({ port }, app.fetch)
}
