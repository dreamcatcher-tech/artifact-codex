import { serializeError } from 'serialize-error'
import { Context, Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { envs } from '@artifact/shared'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'
import { createComputerManager } from './computers.ts'
import { FLY_REPLAY_CONTENT_TYPE, type FlyReplayPayload } from './fly-replay.ts'
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
  workerPoolApp?: string
}

export const createApp = (options: CreateAppOptions = {}) => {
  const app = new Hono<{ Variables: ClerkAuthVariables }>()
  const {
    baseDomain = envs.DC_DOMAIN(),
    workerPoolApp = envs.DC_WORKER_POOL_APP(),
  } = options
  const computerManager = createComputerManager(options)

  app.use('*', clerkMiddleware())
  app.use('*', logger())
  app.all('*', async (c, next) => {
    const auth = getAuth(c)

    if (!auth?.userId) {
      return c.text('Unauthorized', 401)
    }
    const client = c.get('clerk')
    const ot = await client.users.getUserOauthAccessToken(auth.userId, 'github')
    console.log('oauthToken:', ot)
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

  app.all('*', async (c, next) => {
    if (!isAgentDomain(c.req.url, baseDomain)) {
      return next()
    }
    const computerId = getComputerId(c.req.url, baseDomain)
    const agentId = getAgentId(c.req.url, baseDomain)
    if (!await computerManager.agentExists(computerId, agentId)) {
      return c.text('Agent not found', 404)
    }

    await computerManager.upsertExec(computerId, agentId)

    const machineId = await computerManager
      .waitForMachineId(computerId, agentId)

    return replayToWorkerApp(c, workerPoolApp, machineId)
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

  app.onError((err, c) => {
    console.error(err)
    const response = serializeError(err)
    return c.text(JSON.stringify(response, null, 2), 500)
  })

  return app
}

function redirectToAgent(
  c: Context,
  baseDomain: string,
  computer: string,
  agent: string,
): Response {
  const incoming = new URL(c.req.url)
  incoming.hostname = `${agent}--${computer}.${baseDomain}`
  return c.redirect(incoming.toString(), 307)
}

function redirectToComputer(
  c: Context,
  baseDomain: string,
  computer: string,
): Response {
  const incoming = new URL(c.req.url)
  incoming.hostname = `${computer}.${baseDomain}`
  return c.redirect(incoming.toString(), 307)
}

function replayToWorkerApp(
  c: Context,
  workerApp: string,
  machineId: string,
): Response {
  if (!workerApp || workerApp.length === 0) {
    throw new Error('worker app is missing')
  }
  const payload: FlyReplayPayload = {
    app: workerApp,
    instance: machineId,
  }

  const res = c.json(payload, 202)
  res.headers.set('content-type', FLY_REPLAY_CONTENT_TYPE)

  console.log('replay to worker app payload:', payload)
  return res
}
