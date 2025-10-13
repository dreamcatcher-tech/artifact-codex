import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HOST, MCP_PORT } from './const.ts'
import process from 'node:process'

export type RemoteClientOptions = {
  /** Optional fetch implementation override (used in tests). */
  fetch?: FetchLike
  /** Optional resolver override for agent URLs (used in tests/tools). */
  resolveAgentUrl?: (agentId: string) => URL
}

function pidIsAlive(id: number): boolean {
  try {
    // Signal 0: probe for existence (no-op if alive; throws if dead)
    process.kill(id, 0)
    return true
  } catch {
    return false
  }
}

export const waitForPidExit = async (pid?: number | null) => {
  if (!pid) {
    return
  }
  while (pidIsAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve))
  }
}

function baseResolver(agentId: string): URL {
  if (agentId === '@self') {
    return new URL(`http://${HOST}:${MCP_PORT}`)
  }
  // Default: resolve to internal DNS for the remote agent
  // TODO need to resolve to the machine id
  // could either kick the exec directly, or go via router
  return new URL(`http://${agentId}.internal`)
}

export async function callRemoteTool(
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
  opts: RemoteClientOptions = {},
): Promise<CallToolResult> {
  const { fetch, resolveAgentUrl = baseResolver } = opts
  const url = resolveAgentUrl(agentId)
  const client = new Client({ name: 'mcp-proxy', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(url, { fetch })
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

export function readErrorText(result: CallToolResult): string {
  const entry = Array.isArray(result.content) ? result.content[0] : undefined
  if (entry && entry.type === 'text' && typeof entry.text === 'string') {
    return entry.text
  }
  return ''
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
    inputSchema: { agentId: z.string(), input: z.string() },
    outputSchema: { interactionId: z.string() },
  },
  interaction_await: {
    title: 'Await Interaction',
    description:
      'Await the result of a previously queued interaction. Returns the echoed value or an error when the agent throws.',
    inputSchema: { agentId: z.string(), interactionId: z.string() },
    outputSchema: { value: z.string() },
  },
  interaction_cancel: {
    title: 'Cancel Interaction',
    description: 'Cancel a pending interaction by id.',
    inputSchema: { agentId: z.string(), interactionId: z.string() },
    outputSchema: { cancelled: z.boolean(), wasActive: z.boolean() },
  },
  interaction_status: {
    title: 'Get Interaction Status',
    description: 'Get the status of a previously queued interaction.',
    inputSchema: { agentId: z.string(), interactionId: z.string() },
    outputSchema: {
      state: z.enum(['pending', 'completed', 'cancelled', 'rejected']),
    },
  },
}

export type ToolResult<T extends Record<string, unknown>> = CallToolResult & {
  structuredContent?: T
}

export type InteractionStart = { interactionId: string }
export type InteractionAwait = { value: string }
export type InteractionCancel = {
  cancelled: boolean
  wasActive: boolean
}
export type InteractionStatus = {
  state: 'pending' | 'completed' | 'cancelled' | 'rejected'
}

export const INTERACTION_TOOL_NAMES = Object.keys(
  INTERACTION_TOOLS,
) as Array<keyof typeof INTERACTION_TOOLS>

export function requireStructured<T extends Record<string, unknown>>(
  result: ToolResult<T>,
): T {
  if (!result || typeof result !== 'object') {
    throw new Error('tool result missing structured content')
  }
  const structured = result.structuredContent
  if (!structured || typeof structured !== 'object') {
    throw new Error('tool result missing structured content')
  }
  return structured
}

export const VIEWS_RESOURCE_NAME = 'views'
export const VIEWS_RESOURCE_URI = 'mcp://views'
export const VIEWS_RESOURCE_METADATA = {
  description: 'Lists the active views exposed by the agent process',
  mimeType: 'application/json',
  title: 'Agent Views',
}
