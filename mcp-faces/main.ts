#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createFacesServer } from './server.ts'
import type { FacesHandlers } from './server.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

/**
 * Resolve an agent id to a base HTTP origin.
 * Stubbed: http://<agentId>.internal
 */
export function resolveAgentToOrigin(agentId: string): URL {
  return new URL(`http://${agentId}.internal`)
}

/**
 * Ensure the URL targets the MCP endpoint at /mcp.
 */
function withMcpPath(origin: URL): URL {
  const url = new URL(origin.toString())
  // Always point to /mcp (ignore existing pathname)
  url.pathname = '/mcp'
  return url
}

export type RemoteClientOptions = {
  /** Optional fetch implementation override (used in tests). */
  fetch?: FetchLike
}

/**
 * Create Faces tool handlers that proxy to a remote MCP server resolved
 * from the provided agentId using the streaming HTTP transport.
 */
export function createRemoteFacesHandlers(
  opts: RemoteClientOptions = {},
): FacesHandlers {
  async function callRemote(
    agentId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const origin = resolveAgentToOrigin(agentId)
    const endpoint = withMcpPath(origin)
    const client = new Client({ name: 'faces-proxy', version: '0.0.1' })
    const transport = new StreamableHTTPClientTransport(endpoint, opts)
    await client.connect(transport)
    const result = await client.callTool({ name: tool, arguments: args })
    return result as CallToolResult
  }

  return {
    list_faces: ({ agentId }: { agentId: string }): Promise<CallToolResult> => {
      return callRemote(agentId, 'list_faces', { agentId })
    },
    create_face: (
      { agentId, faceKind }: { agentId: string; faceKind: string },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'create_face', { agentId, faceKind })
    },
    read_face: (
      { agentId, faceId }: { agentId: string; faceId: string },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'read_face', { agentId, faceId })
    },
    destroy_face: (
      { agentId, faceId }: { agentId: string; faceId: string },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'destroy_face', { agentId, faceId })
    },
  }
}

if (import.meta.main) {
  // When run as a CLI stdio server, register the remote-proxy handlers.
  const base = new McpServer({ name: 'faces-mcp', version: '0.0.1' })
  const server = createFacesServer(base, createRemoteFacesHandlers())

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
