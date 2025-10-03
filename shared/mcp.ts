import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HOST } from './consts.ts'

export type RemoteClientOptions = {
  /** Optional fetch implementation override (used in tests). */
  fetch?: FetchLike
  /** Optional client name for MCP handshake/identification. */
  clientName?: string
}

/**
 * Resolve an agent id to a base HTTP origin.
 * Stubbed: http://<agentId>.internal
 */
function resolveAgentToOrigin(agentId: string): URL {
  // Special-case for calling the currently running agent.
  // If agentId is "@self" we route to the local web server.
  // The self web server listens on PORT (default 8080).
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
  // Keep existing path; just signal MCP via query param presence.
  // Using empty value results in `?mcp=`; presence is what matters server-side.
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
