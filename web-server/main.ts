#!/usr/bin/env -S deno run -A
import { Hono } from '@hono/hono'
import { mcpHandler } from './mcp.ts'
import { proxyHTTP, proxyWS } from './proxy.ts'
import Debug from 'debug'
const log = Debug('@artifact/web-server')

type RouteLog = {
  type: 'route'
  method: string
  path: string
  port?: string
  ws?: boolean
}

type ResponseLog = {
  type: 'response'
  method: string
  path: string
  status: number
  statusText: string
  contentType?: string
  ms: number
}

function emit(ev: RouteLog | ResponseLog) {
  log('%o', ev)
}

export function createApp() {
  log('createApp: init')
  const app = new Hono()
  const mcp = mcpHandler()
  app.use('*', async (c, next) => {
    const started = Date.now()
    const port = c.req.header('fly-forwarded-port')
    if (port && port !== '443') {
      const isWS = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      emit({
        type: 'route',
        method: c.req.method,
        path: c.req.path,
        port,
        ws: isWS,
      })
      if (isWS) {
        const res = proxyWS(c.req.raw)
        emit({
          type: 'response',
          method: c.req.method,
          path: c.req.path,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get('content-type') ?? undefined,
          ms: Date.now() - started,
        })
        return res
      }
      const res = await proxyHTTP(c.req.raw)
      emit({
        type: 'response',
        method: c.req.method,
        path: c.req.path,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get('content-type') ?? undefined,
        ms: Date.now() - started,
      })
      return res
    }

    if (c.req.query('mcp') !== undefined) {
      emit({ type: 'route', method: c.req.method, path: c.req.path })
      const res = await mcp.handler(c) as Response
      emit({
        type: 'response',
        method: c.req.method,
        path: c.req.path,
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get('content-type') ?? undefined,
        ms: Date.now() - started,
      })
      return res
    }

    emit({ type: 'route', method: c.req.method, path: c.req.path })
    await next()
    const res = c.res as Response
    emit({
      type: 'response',
      method: c.req.method,
      path: c.req.path,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? undefined,
      ms: Date.now() - started,
    })
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
  const { app } = createApp()
  log('serve: starting on :%d', port)
  Deno.serve({ port }, app.fetch)
}
