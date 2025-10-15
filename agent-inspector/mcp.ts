import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  toStructured,
} from '@artifact/shared'

export function register(server: McpServer) {
  const abort = new AbortController()
  server.server.onclose = () => {
    console.log('server closed')
    abort.abort()
  }

  //CLIENT_PORT=8080 SERVER_PORT=9000
  const env = {
    ALLOWED_ORIGINS: '*',
    MCP_AUTO_OPEN_ENABLED: 'false',
  }

  const command = new Deno.Command('npx', {
    args: ['-y', '@modelcontextprotocol/inspector'],
    clearEnv: true,
    env,
    signal: abort.signal,
  })
  command.spawn()
  const views: AgentView[] = [
    {
      name: 'client',
      port: 6274,
      protocol: 'http',
      url: `http://${HOST}:6274`,
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
  server.registerTool(
    'interaction_views',
    INTERACTION_TOOLS.interaction_views,
    () => {
      return toStructured({ views })
    },
  )
}
