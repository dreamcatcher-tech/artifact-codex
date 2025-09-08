import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Schemas for interaction tools
export const interactionKindSchema = z.object({
  interaction_kind: z.string(),
  command: z.string(),
  description: z.string(),
})

export const listInteractionsOutput = z.object({
  interaction_kinds: z.array(interactionKindSchema),
})

export const createInteractionOutput = z.object({ interaction_id: z.string() })

export const readInteractionOutput = z.object({
  exists: z.boolean(),
  interaction: z
    .object({
      id: z.string(),
      kind: z.string().optional(),
      command: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      agentPath: z.string(),
    })
    .optional(),
  reason: z.string().optional(),
})

export const destroyInteractionOutput = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
})

type ToolHandler<I> = (
  input: I,
  extra: unknown,
) => Promise<CallToolResult> | CallToolResult

export type InteractionsHandlers = {
  list_interactions: ToolHandler<{ agentPath: string }>
  create_interaction: ToolHandler<
    { agentPath: string; interactionKind: string }
  >
  read_interaction: ToolHandler<{ agentPath: string; interactionId: string }>
  destroy_interaction: ToolHandler<{ agentPath: string; interactionId: string }>
}

export type CreateInteractionsServerOptions = Record<string, never>

/**
 * Register Interactions tools on an existing MCP server and return it.
 */
export function createInteractionsServer(
  server: McpServer,
  impls: InteractionsHandlers,
  _opts: CreateInteractionsServerOptions = {},
): McpServer {
  server.registerTool(
    'list_interactions',
    {
      title: 'List Interactions',
      description:
        'Lists available interaction kinds for a given Agent path. Returns kind identifier, command, and description.',
      inputSchema: { agentPath: z.string() },
      outputSchema: listInteractionsOutput.shape,
    },
    (args, extra) => impls.list_interactions(args, extra),
  )

  server.registerTool(
    'create_interaction',
    {
      title: 'Create Interaction',
      description:
        'Creates an Interaction of the specified kind for the given Agent path. Returns an interaction id.',
      inputSchema: { agentPath: z.string(), interactionKind: z.string() },
      outputSchema: createInteractionOutput.shape,
    },
    (args, extra) => impls.create_interaction(args, extra),
  )

  server.registerTool(
    'read_interaction',
    {
      title: 'Read Interaction',
      description:
        'Reads info about an Interaction by id for the given Agent path, including status.',
      inputSchema: { agentPath: z.string(), interactionId: z.string() },
      outputSchema: readInteractionOutput.shape,
    },
    (args, extra) => impls.read_interaction(args, extra),
  )

  server.registerTool(
    'destroy_interaction',
    {
      title: 'Destroy Interaction',
      description:
        'Destroys an Interaction by id for the given Agent path. Returns ok boolean.',
      inputSchema: { agentPath: z.string(), interactionId: z.string() },
      outputSchema: destroyInteractionOutput.shape,
    },
    (args, extra) => impls.destroy_interaction(args, extra),
  )

  return server
}
