#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import Debug from 'debug'
const log = Debug('@artifact/web-server')

function emit(req: Request, res?: Response) {
  try {
    const method = req.method
    const pathname = new URL(req.url).pathname
    if (res) {
      const text = res.statusText ? ` ${res.statusText}` : ''
      log('%s %s -> %d%s', method, pathname, res.status, text)
    } else {
      log('%s %s', method, pathname)
    }
  } catch {
    // ignore
  }
}

export function createApp() {
  log('createApp: init')
  const app = new Hono()
  const mcp = mcpHandler()
  app.use('*', async (c, next) => {
    log('host:', c.req.header('host'))
    const port = c.req.header('fly-forwarded-port')
    if (port && port !== '443') {
      const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      if (isWS) {
        const res = proxyWS(c.req.raw)
        emit(c.req.raw, res)
        return res
      }
      const res = await proxyHTTP(c.req.raw)
      emit(c.req.raw, res)
      return res
    }

    if (c.req.query('mcp') !== undefined) {
      const res = await mcp.handler(c) as Response
      emit(c.req.raw, res)
      return res
    }

    await next()
    const res = c.res as Response
    emit(c.req.raw, res)
    return res
  })

  // kind with no face, will trigger a new face, if that is permitted

  const close = () => {
    log('createApp: close')
    mcp.close()
  }

  return { app, close }
}

if (import.meta.main) {
  Debug.enable('@artifact/*')
  const port = Number(Deno.env.get('PORT') ?? 8080)
  const hostname = '0.0.0.0'
  const { app } = createApp()
  log('serve: starting on :%d', port)
  Deno.serve({ port, hostname, reusePort: false }, app.fetch)
}
