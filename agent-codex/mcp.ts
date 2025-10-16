import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AGENT_HOME,
  AGENT_TOML,
  AGENT_WORKSPACE,
  INTERACTION_TOOLS,
  toStructured,
} from '@artifact/shared'
import { CodexAgent } from './codex.ts'
import type { CodexAgentOptions, CodexConfig } from './config.ts'
import { join } from '@std/path'
import { parse as parseToml } from '@std/toml'
import { envs } from './env.ts'

export function register(server: McpServer, agentDir: string) {
  let agent: CodexAgent

  const getAgent = async (): Promise<CodexAgent> => {
    if (!agent) {
      const options = await optionsPromise
      agent = new CodexAgent(options)
    }
    return agent
  }

  server.registerTool(
    'interaction_start',
    INTERACTION_TOOLS.interaction_start,
    async ({ input }) => {
      const agent = await getAgent()
      const interactionId = await agent.startInteraction(String(input ?? ''))
      return toStructured({ interactionId })
    },
  )

  server.registerTool(
    'interaction_await',
    INTERACTION_TOOLS.interaction_await,
    async ({ interactionId }) => {
      const agent = await getAgent()
      const value = await agent.awaitInteraction(String(interactionId))
      return toStructured({ value })
    },
  )

  server.registerTool(
    'interaction_cancel',
    INTERACTION_TOOLS.interaction_cancel,
    async ({ interactionId }) => {
      const agent = await getAgent()
      const { cancelled, wasActive } = await agent.cancelInteraction(
        String(interactionId),
      )
      return toStructured({ cancelled, wasActive })
    },
  )

  server.registerTool(
    'interaction_status',
    INTERACTION_TOOLS.interaction_status,
    async ({ interactionId }) => {
      const agent = await getAgent()
      const state = agent.interactionStatus(String(interactionId))
      return toStructured({ state })
    },
  )

  server.registerTool(
    'interaction_views',
    INTERACTION_TOOLS.interaction_views,
    async () => {
      const agent = await getAgent()
      const views = agent.getViews()
      return toStructured({ views })
    },
  )
}
