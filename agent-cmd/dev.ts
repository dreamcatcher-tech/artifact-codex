import { dirname, fromFileUrl } from '@std/path'
import type { AgentResolver } from '@artifact/supervisor'
import { createLoadedFixture } from '@artifact/supervisor/fixture'

const agentFileUrl = new URL('./main.ts', import.meta.url)
const agentFilePath = fromFileUrl(agentFileUrl)
const agentProjectDir = dirname(agentFilePath)

export async function dev(port: number = 8080) {
  const agentResolver: AgentResolver = () =>
    Promise.resolve({
      command: 'deno',
      args: ['run', '-A', agentFilePath],
      env: {},
      cwd: agentProjectDir,
    })

  console.log('Starting agent-cmd fixture...')
  console.log(`Agent entry: ${agentFilePath}`)
  console.log(`Agent cwd: ${agentProjectDir}`)

  const fixture = await createLoadedFixture({ agentResolver })

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

if (import.meta.main) {
  await dev()
}
