import { Context, Hono, type HonoRequest } from '@hono/hono'
import type { AgentView, IdleTrigger, ToolResult } from '@artifact/shared'
import Debug from 'debug'
import { HTTPException } from '@hono/hono/http-exception'
import { agentViewSchema, MCP_PORT, requireStructured } from '@artifact/shared'
import { type AgentResolver, createLoader } from './loader.ts'
import { createExternal, type External } from './external.ts'
import { createInternal, type Internal } from './internal.ts'
import { proxyForwardedRequest } from './proxy.ts'
import { logger } from '@hono/hono/logger'

const log = Debug('@artifact/supervisor')

export type SupervisorEnv = {
  Variables: { requestKind: ClassifiedRequest }
}

export const createApp = (
  idler: IdleTrigger,
  agentResolver?: AgentResolver,
) => {
  const agent = createAgent(idler, agentResolver)

  const app = new Hono<SupervisorEnv>()

  app.use('*', logger(log))
  app.use('*', idler.middleware)

  app.use('*', async (c, next) => {
    if (agent.isLoading) {
      log('agent.isLoading intercepting request', c.req.method, c.req.path)
      return agent.loader(c)
    }
    await next()
  })

  app.use('*', async (c, next) => {
    const cl = await classifyRequest(c.req, agent)
    c.set('requestKind', cl)
    log('request %s %s classified as %s', c.req.method, c.req.path, cl.kind)
    await next()
  })

  app.use('*', (c) => {
    const cl = c.get('requestKind')
    switch (cl.kind) {
      case 'supervisor-mcp':
        log('dispatching supervisor mcp request in state %s', agent.state)
        return agent.external(c)
      case 'agent-mcp':
        log('dispatching internal mcp request in state %s', agent.state)
        return agent.internal(c)
      case 'web': {
        log('proxying web request for port %s', cl.port)
        return proxyForwardedRequest(c, cl.port, idler)
      }
    }
  })

  app.onError((error: Error, c: Context) => {
    if (error instanceof HTTPException) {
      log('error %s %s', c.req.method, c.req.path, error.cause)
      return error.getResponse()
    }
    return c.text('Internal Server Error: ' + error.message, 500)
  })

  const close = agent[Symbol.asyncDispose]
  return { app, close, [Symbol.asyncDispose]: close }
}

const createAgent = (idler: IdleTrigger, agentResolver?: AgentResolver) => {
  let state: AgentState = 'loading'
  const loader = createLoader(() => setState('ready'), agentResolver)

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
    get client() {
      assertState(state, 'ready', loader.client)
      return loader.client
    },
    getDefaultViewPort: async (): Promise<number> => {
      assertState(state, 'ready', loader.client)
      const viewsResult = await loader.client.callTool({
        name: 'interaction_views',
        arguments: {},
      }) as ToolResult<{ views: AgentView[] }>
      const { views } = requireStructured(viewsResult)
      if (!Array.isArray(views) || views.length === 0) {
        throw new HTTPException(503, {
          message: 'Agent has no active views yet',
        })
      }
      const view = agentViewSchema.parse(views[0])
      return view.port
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

type Agent = ReturnType<typeof createAgent>

function parsePort(v: string | undefined): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

const classifyRequest = async (
  req: HonoRequest,
  agent: Agent,
): Promise<ClassifiedRequest> => {
  const forwardedPort = parsePort(req.header('fly-forwarded-port'))
  if (forwardedPort === MCP_PORT) {
    return { kind: 'supervisor-mcp' }
  }
  if (isAgentMcpRequest(req, forwardedPort)) {
    return { kind: 'agent-mcp' }
  }
  let port = forwardedPort
  if (!port || port === 443) {
    port = await agent.getDefaultViewPort()
  }
  return { kind: 'web', port }
}

const isAgentMcpRequest = (req: HonoRequest, forwardedPort: number | null) => {
  if (forwardedPort !== null) {
    return false
  }
  if (isLocalhostRequest(req)) {
    const authHeader = req.header('authorization')
    if (!authHeader) {
      return false
    }
    const scheme = authHeader.trim().split(/\s+/)[0]?.toLowerCase()
    return scheme === 'bearer'
  }
  return false
}

const isLocalhostRequest = (req: HonoRequest) => {
  const url = new URL(req.url)
  const hostname = url.hostname
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
}

type AgentState = 'loading' | 'ready' | 'shuttingDown'

type ClassifiedRequest =
  | { kind: 'supervisor-mcp' }
  | { kind: 'agent-mcp' }
  | { kind: 'web'; port: number }

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
