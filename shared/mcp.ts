import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
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

/** Ensure the URL targets the MCP endpoint via `?mcp` query param. */
function withMcpPath(origin: URL): URL {
  const url = new URL(origin.toString())
  const params = url.searchParams
  if (!params.has('mcp')) params.set('mcp', '')
  url.search = params.toString()
  return url
}

/**
 * Call a remote MCP tool hosted at the agent's `?mcp` endpoint.
 */
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
