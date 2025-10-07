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

function resolveAgentUrl(agentId: string): URL {
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
  const url = resolveAgentUrl(agentId)
  const client = new Client({ name: 'mcp-proxy', version: '0.0.1' })
  const transport = new StreamableHTTPClientTransport(url, opts)
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
