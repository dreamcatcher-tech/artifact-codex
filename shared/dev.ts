import { basename, dirname, fromFileUrl } from '@std/path'
import type { AgentResolver } from '@artifact/supervisor'
import { createLoadedFixture } from '@artifact/supervisor/fixture'

type CreateAgentDevOptions = {
  /** Optional port that the returned dev handler will default to. */
  defaultPort?: number
  env?: Record<string, string | number | boolean>
  setup?: () => Promise<{ [Symbol.asyncDispose]: () => Promise<void> }>
}

type AgentDev = (port?: number) => Promise<void>

export function createAgentDev(
  meta: ImportMeta,
  { defaultPort = 8080, env = {}, setup }: CreateAgentDevOptions = {},
): AgentDev {
  const agentFileUrl = new URL('./main.ts', meta.url)
  const agentFilePath = fromFileUrl(agentFileUrl)
  const agentProjectDir = dirname(agentFilePath)
  const agentLabel = basename(agentProjectDir)

  const agentResolver: AgentResolver = () =>
    Promise.resolve({
      command: 'deno',
      args: ['run', '-A', agentFilePath],
      env,
      cwd: agentProjectDir,
    })

  return async (port: number = defaultPort) => {
    console.log(`Starting ${agentLabel} fixture...`)
    console.log(`Agent entry: ${agentFilePath}`)
    console.log(`Agent cwd: ${agentProjectDir}`)

    await using _ = await setup?.()

    await using fixture = await createLoadedFixture({ agentResolver })

    const server = Deno.serve({
      port,
      hostname: 'localhost',
      onListen: ({ hostname, port }) => {
        console.log(`Fixture ready at http://${hostname}:${port}/`)
        console.log('Press Ctrl+C to stop.')
      },
    }, fixture.app.fetch)

    await server.finished
  }
}
