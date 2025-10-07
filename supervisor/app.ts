import { Context, Hono, type HonoRequest, Next } from '@hono/hono'
import type { IdleTrigger } from '@artifact/shared'
import Debug from 'debug'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpHandler } from './mcp-handler.ts'
import { HTTPException } from '@hono/hono/http-exception'
import { MCP_PORT } from '@artifact/shared'
import { portFromHeaders } from './utils.ts'
import { logger } from '@hono/hono/logger'

const log = Debug('@artifact/supervisor')

type SupervisorEnv = {
  Variables: { requestKind: ClassifiedRequest }
}

export const createSupervisor = (idler: IdleTrigger) => {
  const agent = createAgent()

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
      if (cl.kind !== 'supervisor-mcp') {
        const message = 'Bad Request: awaiting agent loading'
        throw new HTTPException(400, { message })
      }
      log('agent@  %s intercepting %s request', agent.state, cl.kind)
      return agent.loadHandler(c.req)
    }
    await next()
  })

  app.use('*', (c, next) => {
    const cl = c.get('requestKind')
    switch (cl.kind) {
      case 'supervisor-mcp':
        log('dispatching supervisor mcp request in state %s', agent.state)
        return agent.mcpSupervisorHandler(c.req)
      case 'agent-mcp':
        log('dispatching agent mcp request in state %s', agent.state)
        return agent.mcpAgentHandler(c.req)
      case 'web':
        log('proxying web request for port %s', cl.port)
        return next() //do the proxy
    }
  })

  return { app, [Symbol.asyncDispose]: agent[Symbol.asyncDispose] }
}

const createAgent = () => {
  let state: AgentState = 'loading'

  const setState = (nextState: AgentState) => {
    if (state === nextState) {
      return
    }
    log('agent state %s → %s', state, nextState)
    state = nextState
  }

  return {
    get state() {
      return state
    },
    get isLoading() {
      return state === 'loading'
    },
    transitionToReady: () => setState('ready'),
    transitionToShuttingDown: () => setState('shuttingDown'),
    loadHandler: async (req: HonoRequest) => {
      assertState(state, 'loading')
      // if there is already a running request, throw an error
      if (isSupervisorMcpRequest(req)) {
        // do stuff
      }
      const message = 'Bad Request: awaiting provisioning'
      throw new HTTPException(400, { message })
    },
    mcpSupervisorHandler: async (req: HonoRequest) => {
      log(
        'supervisor mcp handler received %s %s in state %s',
        req.method,
        req.path,
        state,
      )
      // take in any supervisor mcp requests
    },
    mcpAgentHandler: async (req: HonoRequest) => {
      log(
        'agent mcp handler received %s %s in state %s',
        req.method,
        req.path,
        state,
      )
      // take in any operating mcp requests
    },
    [Symbol.asyncDispose]: async () => {
      log('disposing agent in state %s', state)
      setState('shuttingDown')
      // clear out all the mcp servers
      // shut down the agent mcp client
      // shut down the agent mcp server
    },
  }
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

const isSupervisorMcpRequest = (req: HonoRequest) => {
  return portFromHeaders(req) === MCP_PORT
}

const isAgentMcpRequest = (req: HonoRequest, port: number | null) => {
  if (port !== null) {
    return false
  }
  // Internal MCP traffic is expected to originate from machines that do not
  // traverse Fly's edge, so there is no port header. Additional heuristics can
  // be layered here (machine ids, auth headers, etc.) as the protocol evolves.
  const machineId = req.header('fly-machine-id')
  return Boolean(machineId)
}

type AgentState = 'loading' | 'ready' | 'shuttingDown'

type ClassifiedRequest =
  | { kind: 'supervisor-mcp' }
  | { kind: 'agent-mcp' }
  | { kind: 'web'; port: number | null }

const assertState = (state: AgentState, expected: AgentState) => {
  if (state !== expected) {
    throw new HTTPException(500, {
      message: `Agent state is ${state} but expected ${expected}`,
    })
  }
}
