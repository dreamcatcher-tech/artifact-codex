#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createInteractionsServer } from './server.ts'
import { callRemoteTool, type RemoteClientOptions } from '@artifact/shared'

/**
 * Create Interaction tool handlers that proxy to a remote MCP server resolved
 * from the provided agentId using the streaming HTTP transport.
 */
export function createRemoteInteractionsHandlers(
  opts: RemoteClientOptions = {},
) {
  async function callRemote(
    agentId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    return await callRemoteTool(agentId, tool, args, {
      ...opts,
      clientName: 'interactions-proxy',
    })
  }

  return {
    list_interactions: (
      { agentId, faceId }: { agentId: string; faceId: string },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'list_interactions', { agentId, faceId })
    },
    create_interaction: (
      { agentId, faceId, input }: {
        agentId: string
        faceId: string
        input: string
      },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'create_interaction', {
        agentId,
        faceId,
        input,
      })
    },
    read_interaction: (
      { agentId, interactionId }: {
        agentId: string
        interactionId: string
      },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'read_interaction', { agentId, interactionId })
    },
    destroy_interaction: (
      { agentId, interactionId }: {
        agentId: string
        interactionId: string
      },
    ): Promise<CallToolResult> => {
      return callRemote(agentId, 'destroy_interaction', {
        agentId,
        interactionId,
      })
    },
  }
}

if (import.meta.main) {
  // When run as a CLI stdio server, register the remote-proxy handlers.
  const base = new McpServer({ name: 'interactions-mcp', version: '0.0.1' })
  const server = createInteractionsServer(
    base,
    createRemoteInteractionsHandlers(),
  )
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
