#!/usr/bin/env -S deno run -A
import Debug from 'debug'

import {
  createAgentWebServer,
  type CreateAgentWebServerResult,
} from '@artifact/web-server'

import { createAgentBasicOptions } from './server-options.ts'

export function createApp(): CreateAgentWebServerResult {
  const options = createAgentBasicOptions()
  return createAgentWebServer(options)
}

if (import.meta.main) {
  Debug.enable('@artifact/*')
  const port = Number(Deno.env.get('PORT') ?? 8080)
  const hostname = '0.0.0.0'
  const { app } = createApp()
  const options = { port, hostname, reusePort: false }
  const log = Debug('@artifact/agent-basic:serve')
  log('serve: starting on :%d', port)
  Deno.serve(options, app.fetch)
}
