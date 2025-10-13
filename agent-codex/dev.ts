import { dirname, fromFileUrl } from '@std/path'
import type { AgentResolver } from '../supervisor/loader.ts'
import { createLoadedFixture } from '../supervisor/fixture.ts'
import { envs } from './env.ts'
import { createTempHostFs } from '@artifact/shared'

const agentFileUrl = new URL('./main.ts', import.meta.url)
const agentFilePath = fromFileUrl(agentFileUrl)
const agentProjectDir = dirname(agentFilePath)

export async function main(port: number = 8000) {
  const OPENAI_API_KEY = envs.OPENAI_API_KEY()

  await using fs = await createTempHostFs()
  const { workspaceDir, homeDir, notifyDir } = fs

  const agentResolver: AgentResolver = () =>
    Promise.resolve({
      command: 'deno',
      args: ['run', '-A', agentFilePath],
      env: {
        OPENAI_API_KEY,
        CODEX_AGENT_WORKSPACE: workspaceDir,
        CODEX_AGENT_HOME: homeDir,
        CODEX_AGENT_LAUNCH: 'disabled',
        CODEX_AGENT_NOTIFY_DIR: notifyDir,
      },
      cwd: agentProjectDir,
    })

  console.log('Starting agent-codex fixture...')
  console.log(`Agent entry: ${agentFilePath}`)
  console.log(`Agent cwd: ${agentProjectDir}`)
  console.log(`Workspace dir: ${workspaceDir}`)
  console.log(`Home dir: ${homeDir}`)
  console.log(`Notify dir: ${notifyDir}`)

  const fixture = await createLoadedFixture({ agentResolver })

  Deno.serve({
    port,
    hostname: 'localhost',
    onListen: ({ hostname, port }) => {
      console.log(`Fixture ready at http://${hostname}:${port}/`)
      console.log('Press Ctrl+C to stop.')
    },
  }, fixture.app.fetch)
}

if (import.meta.main) {
  await main()
}
