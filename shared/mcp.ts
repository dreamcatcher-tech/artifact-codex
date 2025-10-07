import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HOST } from './const.ts'

export type RemoteClientOptions = {
  /** Optional fetch implementation override (used in tests). */
  fetch?: FetchLike
  /** Optional client name for MCP handshake/identification. */
  clientName?: string
}

function resolveAgentToOrigin(agentId: string): URL {
  if (agentId === '@self') {
    const port = Deno.env.get('PORT') ?? '8080'
    return new URL(`http://${HOST}:${port}`)
  }
  // Default: resolve to internal DNS for the remote agent
  return new URL(`http://${agentId}.internal`)
}

export async function callRemoteTool(
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
  opts: RemoteClientOptions = {},
): Promise<CallToolResult> {
  const origin = resolveAgentToOrigin(agentId)
  const endpoint = withMcpPath(origin)
  const client = new Client({
    name: opts.clientName ?? 'mcp-proxy',
    version: '0.0.1',
  })
  const transport = new StreamableHTTPClientTransport(endpoint, opts)
  await client.connect(transport)
  try {
    const result = await client.callTool({ name: tool, arguments: args })
    return result as CallToolResult
  } finally {
    await client.close()
  }
}

export function toStructured(
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(structuredContent, null, 2),
    }],
    structuredContent,
  }
}

export function toError(err: unknown): CallToolResult {
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: msg }], isError: true }
}

export type ToolConfig = {
  title: string
  description: string
  inputSchema: z.ZodRawShape
  outputSchema: z.ZodRawShape
}

export const INTERACTION_TOOLS: Record<string, ToolConfig> = {
  interaction_start: {
    title: 'Start Interaction',
    description: 'Queue a new interaction.',
    inputSchema: { input: z.string() },
    outputSchema: { interactionId: z.string() },
  },
  interaction_await: {
    title: 'Await Interaction',
    description:
      'Await the result of a previously queued interaction. Returns the echoed value or an error when the agent throws.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { value: z.string() },
  },
  interaction_cancel: {
    title: 'Cancel Interaction',
    description: 'Cancel a pending interaction by id.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { cancelled: z.boolean(), wasActive: z.boolean() },
  },
  interaction_status: {
    title: 'Get Interaction Status',
    description: 'Get the status of a previously queued interaction.',
    inputSchema: { interactionId: z.string() },
    outputSchema: { state: z.enum(['pending', 'completed', 'cancelled']) },
  },
}
