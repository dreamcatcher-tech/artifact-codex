import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Schemas for interaction tools

export const readInteractionOutput = z.object({
  exists: z.boolean(),
  interaction: z
    .object({
      id: z.string(),
      kind: z.string().optional(),
      command: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      agentId: z.string(),
    })
    .optional(),
  reason: z.string().optional(),
})

type ToolHandler<I> = (
  input: I,
  extra: unknown,
) => Promise<CallToolResult> | CallToolResult

export type InteractionsHandlers = {
  list_interactions: ToolHandler<{ agentId: string; faceId: string }>
  create_interaction: ToolHandler<
    { agentId: string; faceId: string; input: string }
  >
  read_interaction: ToolHandler<{ agentId: string; interactionId: string }>
  destroy_interaction: ToolHandler<{ agentId: string; interactionId: string }>
}

export type CreateInteractionsServerOptions = Record<string, never>

/**
 * Register Interactions tools on an existing MCP server and return it.
 */
export function createInteractionsServer(
  server: McpServer,
  handlers: InteractionsHandlers,
): McpServer {
  server.registerTool(
    'list_interactions',
    {
      title: 'List Interactions',
      description:
        'Lists pending interaction IDs for a given Face. Use "@self" as agentId to target the currently running agent via the local web server.',
      inputSchema: { agentId: z.string(), faceId: z.string() },
      outputSchema: { interactionIds: z.array(z.string()) },
    },
    (args, extra) => handlers.list_interactions(args, extra),
  )

  server.registerTool(
    'create_interaction',
    {
      title: 'Create Interaction',
      description:
        `Creates an Interaction of the specified kind for the given Agent ID. Returns an interaction id. Use "@self" as agentId to target your own Agent ID.`,
      inputSchema: {
        agentId: z.string(),
        faceId: z.string(),
        input: z.string(),
      },
      outputSchema: { interactionId: z.string() },
    },
    (args, extra) => handlers.create_interaction(args, extra),
  )

  server.registerTool(
    'read_interaction',
    {
      title: 'Read Interaction',
      description:
        'Reads info about an Interaction by id for the given Agent id, including status. Use "@self" as agentId to target the current agent.',
      inputSchema: { agentId: z.string(), interactionId: z.string() },
      outputSchema: { result: z.string(), input: z.string() },
    },
    (args, extra) => handlers.read_interaction(args, extra),
  )

  server.registerTool(
    'destroy_interaction',
    {
      title: 'Destroy Interaction',
      description:
        'Destroys an Interaction by id for the given Agent id. Returns ok boolean. Use "@self" as agentId to target the current agent.',
      inputSchema: {
        agentId: z.string(),
        interactionId: z.string(),
      },
      outputSchema: { ok: z.boolean() },
    },
    (args, extra) => handlers.destroy_interaction(args, extra),
  )

  return server
}
