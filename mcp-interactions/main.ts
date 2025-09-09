#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toError, toStructured } from '@artifact/shared'
import { createInteractionsServer } from './server.ts'

const base = new McpServer({ name: 'interactions-mcp', version: '0.0.1' })
const server = createInteractionsServer(base, {
  list_interactions: ({ agentId }, extra): Promise<CallToolResult> => {
    console.log('list_interactions', { agentId, extra })
    try {
      return Promise.resolve(toStructured({ interaction_kinds: [] }))
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  create_interaction: (
    { agentId, faceId, input },
    extra,
  ): Promise<CallToolResult> => {
    console.log('create_interaction', { agentId, faceId, input, extra })
    try {
      return Promise.resolve(
        toStructured({ interaction_id: `stub-${crypto.randomUUID()}` }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  read_interaction: (
    { agentId, interactionId },
    extra,
  ): Promise<CallToolResult> => {
    console.log('read_interaction', { agentId, interactionId, extra })
    try {
      return Promise.resolve(
        toStructured({ exists: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  destroy_interaction: (
    { agentId, interactionId },
    extra,
  ): Promise<CallToolResult> => {
    console.log('destroy_interaction', { agentId, interactionId, extra })
    try {
      return Promise.resolve(
        toStructured({ ok: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
})

const transport = new StdioServerTransport()
await server.connect(transport)
