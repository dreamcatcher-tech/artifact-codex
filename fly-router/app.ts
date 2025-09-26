import { Context, Hono } from '@hono/hono'
import { envs } from '@artifact/shared'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'
import { createComputerManager } from './computers.ts'
import {
  getAgentId,
  getComputerId,
  isAgentDomain,
  isBaseDomain,
  isComputerDomain,
} from './hostnames.ts'

const TEST_COMPUTER_HEADER = 'x-artifact-test-user'
const TEST_COMPUTER_ID = 'test-computer'

type CreateAppOptions = {
  baseDomain?: string
  computerDir?: string
  execApp?: string
}

export const createApp = (options: CreateAppOptions = {}) => {
  const app = new Hono<{ Variables: ClerkAuthVariables }>()
  const { baseDomain = envs.DC_DOMAIN(), execApp = envs.DC_EXEC() } = options
  const computerManager = createComputerManager(options)

  app.use('*', clerkMiddleware())

  app.all('*', async (c, next) => {
    const auth = getAuth(c)
    if (!auth?.userId) {
      return c.text('Unauthorized', 401)
    }
    return await next()
  })

  app.all('*', async (c, next) => {
    if (!isBaseDomain(c.req.url, baseDomain)) {
      return next()
    }

    const computerId = TEST_COMPUTER_ID
    await computerManager.upsertComputer(computerId)

    return redirectToComputer(c, baseDomain, computerId)
  })

  app.all('*', async (c, next) => {
    if (!isComputerDomain(c.req.url, baseDomain)) {
      return next()
    }
    const computerId = getComputerId(c.req.url, baseDomain)
    if (!await computerManager.computerExists(computerId)) {
      return c.text('Computer not found', 404)
    }

    const agentId = await computerManager.upsertLandingAgent(computerId)

    return redirectToAgent(c, baseDomain, computerId, agentId)
  })

  app.get('*', async (c, next) => {
    if (!isAgentDomain(c.req.url, baseDomain)) {
      return next()
    }
    const computerId = getComputerId(c.req.url, baseDomain)
    const agentId = getAgentId(c.req.url, baseDomain)
    if (!await computerManager.agentExists(computerId, agentId)) {
      return c.text('Agent not found', 404)
    }

    await computerManager.upsertExec(computerId, agentId)

    const machineId = await computerManager.execRunning(computerId, agentId)

    return replayToExecApp(c, execApp, machineId)
  })

  app.delete('/integration/computer', async (c) => {
    const computerId = c.req.header(TEST_COMPUTER_HEADER)
    if (computerId !== TEST_COMPUTER_ID) {
      return c.json({ error: 'test computer id mismatch' }, 401)
    }

    const existed = await computerManager.computerExists(computerId)
    await computerManager.deleteComputer(computerId)

    return c.json({ success: true, existed })
  })

  return app
}

function redirectToAgent(
  c: Context,
  baseDomain: string,
  computer: string,
  agent: string,
): Response {
  const res = c.redirect(`${agent}--${computer}.${baseDomain}`)
  return res
}

function redirectToComputer(
  c: Context,
  baseDomain: string,
  computer: string,
): Response {
  const res = c.redirect(`${computer}.${baseDomain}`)
  return res
}

function replayToExecApp(c: Context, app: string, machineId: string): Response {
  const res = c.body(null)
  res.headers.set('fly-replay', `app=${app};fly_prefer_instance=${machineId}`)
  return res
}
