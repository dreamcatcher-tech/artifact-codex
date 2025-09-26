import { Context, Hono, type HonoRequest } from '@hono/hono'
import { envs } from '@artifact/shared'
import {
  type ClerkAuthVariables,
  clerkMiddleware,
  getAuth,
} from '@hono/clerk-auth'
import { createComputerManager } from './computers.ts'

const TEST_COMPUTER_HEADER = 'x-artifact-test-user'
const TEST_COMPUTER_ID = 'test-computer'

type CreateAppOptions = {
  baseDomain?: string
  computerDir?: string
}

export const createApp = (options: CreateAppOptions = {}) => {
  const app = new Hono<{ Variables: ClerkAuthVariables }>()
  const { baseDomain = envs.DC_DOMAIN() } = options
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
    if (!computerManager.computerExists(computerId)) {
      return c.text('Computer not found', 404)
    }

    // find the landing agent or create one if configured to do so

    // post to the exec service to notify it that the computer has changed and await a response

    return redirectToAgent(c, baseDomain, computerId, agentId)
  })

  app.get('*', async (c, next) => {
    if (!isAgentDomain(c.req.url, baseDomain)) {
      return next()
    }
    const computerId = getComputerId(c.req.url, baseDomain)
    if (!computerManager.computerExists(computerId)) {
      return c.text('Computer not found', 404)
    }
    const agentId = getAgentId(c.req.url, baseDomain)
    if (!computerManager.agentExists(computerId, agentId)) {
      return c.text('Agent not found', 404)
    }

    await computerManager.upsertExecInstance(computerId, agentId)

    const machineId = await computerManager.execRunning(computerId, agentId)

    return replayToExecApp(c, baseDomain, computerId, machineId)
  })

  app.delete('/integration/computer', async (c) => {
    const computerId = c.req.header(TEST_COMPUTER_HEADER)
    if (computerId !== TEST_COMPUTER_ID) {
      return c.json({ error: 'test computer id mismatch' }, 401)
    }

    const existed = await computerManager.computerExists(computerId)
    await computerManager.shutdownComputer(computerId)
    await computerManager.deleteComputer(computerId)

    return c.json({ success: true, existed })
  })

  return app
}

function assertHostname(hostname: string, baseDomain: string): void {
  if (!hostname.endsWith(baseDomain)) {
    throw new Error(`hostname mismatch: ${hostname} !endsWith ${baseDomain}`)
  }
}

function isBaseDomain(urlString: string, baseDomain: string): boolean {
  const url = new URL(urlString)
  assertHostname(url.hostname, baseDomain)
  return url.hostname === baseDomain
}

function getSubdomain(urlString: string, baseDomain: string): string {
  const url = new URL(urlString)
  assertHostname(url.hostname, baseDomain)
  const subdomain = url.hostname.slice(0, -baseDomain.length)
  if (!subdomain) {
    throw new Error('subdomain is empty')
  }
  if (subdomain.includes('.')) {
    throw new Error('subdomain contains a dot')
  }
  return subdomain
}

function isComputerDomain(urlString: string, baseDomain: string): boolean {
  const subdomain = getSubdomain(urlString, baseDomain)
  console.log('subdomain', subdomain)

  if (subdomain.includes('--')) {
    return false
  }
  return true
}

function isAgentDomain(urlString: string, baseDomain: string): boolean {
  const subdomain = getSubdomain(urlString, baseDomain)
  console.log('subdomain', subdomain)
  if (!subdomain.includes('--')) {
    throw new Error('subdomain does not contain --')
  }
  return true
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
