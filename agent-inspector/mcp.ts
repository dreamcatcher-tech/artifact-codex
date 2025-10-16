import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AgentView,
  HOST,
  INTERACTION_TOOLS,
  toStructured,
} from '@artifact/shared'

export function register(server: McpServer) {
  const abort = new AbortController()

  //CLIENT_PORT=8080 SERVER_PORT=9000
  const env = {
    ALLOWED_ORIGINS: '*',
    MCP_AUTO_OPEN_ENABLED: 'false',
  }

  const command = new Deno.Command('npx', {
    args: ['-y', '@modelcontextprotocol/inspector'],
    env,
    signal: abort.signal,
    stdout: 'null', // without this, the child process will leak resources
    stdin: 'null', // without this, the stdio comms will break
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
