#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createFacesServer } from './server.ts'
import type { FacesHandlers } from './server.ts'
import { callRemoteTool, type RemoteClientOptions } from '@artifact/shared'

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
    // keep local function name but delegate to shared
    return await callRemoteTool(agentId, tool, args, {
      ...opts,
      clientName: 'faces-proxy',
    })
  }

  return {
    list_faces: ({ agentId }: { agentId: string }): Promise<CallToolResult> => {
      return callRemote(agentId, 'list_faces', { agentId })
    },
    create_face: (
      {
        agentId,
        faceKind,
        home,
        workspace,
        config,
      }: {
        agentId: string
        faceKind: string
        home?: string
        workspace?: string
        config?: Record<string, unknown>
      },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'create_face', {
        agentId,
        faceKind,
        home,
        workspace,
        config,
      })
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
