#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'

export function createApp() {
  const app = new Hono()
  const mcp = mcpHandler()
  app.all('/mcp', mcp.handler)

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
