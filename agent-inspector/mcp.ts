import {
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  type Register,
  toStructured,
  waitForPort,
} from '@artifact/shared'

const INSPECTOR_PORT = 6274

export const register: Register = (server) => {
  //CLIENT_PORT=8080 SERVER_PORT=9000
  const env = {
    ALLOWED_ORIGINS: 'http://localhost:8080/',
    MCP_AUTO_OPEN_ENABLED: 'false',
    HOST,
  }

  const command = new Deno.Command('npx', {
    args: ['-y', '@modelcontextprotocol/inspector'],
    env,
    stdout: 'null',
    stdin: 'null',
  })

  command.spawn()

  const views: AgentView[] = [
    {
      name: 'client',
      port: INSPECTOR_PORT,
      protocol: 'http',
      url: `http://${HOST}:${INSPECTOR_PORT}`,
    },
  ]

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    () => {
      throw new Error('agent-inspector does not support interactions')
    },
  )

  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    () => {
      throw new Error('agent-inspector does not support interactions')
    },
  )

  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    () => {
      throw new Error('agent-inspector does not support interactions')
    },
  )

  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    () => {
      throw new Error('agent-inspector does not support interactions')
    },
  )

  let waitForPortPromise: Promise<void>

  server.registerTool(
    'interaction_views',
    INTERACTION_TOOLS.interaction_views,
    async () => {
      if (!waitForPortPromise) {
        waitForPortPromise = waitForPort(INSPECTOR_PORT, HOST)
      }
      await waitForPortPromise
      return toStructured({ views })
    },
  )
}
