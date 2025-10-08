import { Context, Hono, type HonoRequest } from '@hono/hono'
import type { IdleTrigger } from '@artifact/shared'
import Debug from 'debug'
import { HTTPException } from '@hono/hono/http-exception'
import { MCP_PORT } from '@artifact/shared'
import { logger } from '@hono/hono/logger'
import { createLoader } from './loader.ts'
import { createExternal, type External } from './external.ts'
import { createInternal, type Internal } from './internal.ts'
import { proxyForwardedRequest } from './proxy.ts'

const log = Debug('@artifact/supervisor')

export type SupervisorEnv = {
  Variables: { requestKind: ClassifiedRequest }
}

export const createApp = (idler: IdleTrigger) => {
  const agent = createAgent(idler)

  const app = new Hono<SupervisorEnv>()

  app.use('*', logger())
  app.use('*', idler.middleware)

  app.use('*', async (c, next) => {
    const cl = classifyRequest(c.req)
    c.set('requestKind', cl)
    log('request %s %s classified as %s', c.req.method, c.req.path, cl.kind)
    await next()
  })

  app.use('*', async (c, next) => {
    const cl = c.get('requestKind')
    if (agent.isLoading) {
      log('agent@  %s intercepting %s request', agent.state, cl.kind)
      return agent.loader(c)
    }
    await next()
  })

  app.use('*', (c, next) => {
    const cl = c.get('requestKind')
    switch (cl.kind) {
      case 'supervisor-mcp':
        log('dispatching supervisor mcp request in state %s', agent.state)
        return agent.external(c)
      case 'agent-mcp':
        log('dispatching internal mcp request in state %s', agent.state)
        return agent.internal(c)
      case 'web':
        log('proxying web request for port %s', cl.port)
        return proxyForwardedRequest(c, next, cl.port, idler)
    }
  })

  const close = agent[Symbol.asyncDispose]
  return { app, close, [Symbol.asyncDispose]: close }
}

const createAgent = (idler: IdleTrigger) => {
  let state: AgentState = 'loading'
  const loader = createLoader(() => setState('ready'))

  const setState = (nextState: AgentState) => {
    log('agent state %s → %s', state, nextState)
    state = nextState
    if (state === 'ready') {
      external = createExternal(loader.client, idler)
      internal = createInternal()
    }
  }

  let external: External | undefined
  let internal: Internal | undefined

  const agent = {
    get state() {
      return state
    },
    get isLoading() {
      return state === 'loading'
    },
    loader: (c: Context) => {
      assertState(state, 'loading', loader)
      return loader.handler(c)
    },
    external: (c: Context) => {
      assertState(state, 'ready', external)
      return external.handler(c)
    },
    internal: (c: Context) => {
      assertState(state, 'ready', internal)
      return internal.handler(c)
    },
    [Symbol.asyncDispose]: async () => {
      log('disposing agent in state %s', state)
      setState('shuttingDown')
      await external?.close()
      external = undefined
      await internal?.close()
      internal = undefined
      await loader.close()
    },
  }
  return agent
}

const classifyRequest = (req: HonoRequest): ClassifiedRequest => {
  const port = portFromHeaders(req)
  if (port === MCP_PORT) {
    return { kind: 'supervisor-mcp' }
  }
  if (isAgentMcpRequest(req, port)) {
    return { kind: 'agent-mcp' }
  }
  return { kind: 'web', port }
}

const isAgentMcpRequest = (req: HonoRequest, port: number | null) => {
  if (port !== null) {
    return false
  }
  // if no port, and came from local machine, and has auth header
  const machineId = req.header('fly-machine-id')
  return Boolean(machineId)
}

type AgentState = 'loading' | 'ready' | 'shuttingDown'

type ClassifiedRequest =
  | { kind: 'supervisor-mcp' }
  | { kind: 'agent-mcp' }
  | { kind: 'web'; port: number | null }

function assertState<T>(
  state: AgentState,
  expected: AgentState,
  handler: T | undefined,
): asserts handler is T {
  if (state === 'shuttingDown') {
    throw new HTTPException(500, { message: 'Agent is shutting down' })
  }
  if (state !== expected) {
    throw new HTTPException(500, {
      message: `Agent state is ${state} but expected ${expected}`,
    })
  }
  if (handler === undefined) {
    throw new HTTPException(500, { message: 'Handler is not ready' })
  }
}

function parsePort(v: string | undefined): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

function portFromHeaders(req: HonoRequest): number | null {
  return parsePort(req.header('fly-forwarded-port'))
}
