#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toError, toStructured } from '@artifact/shared'
import { createFacesServer } from './server.ts'

// Default stub implementations used when running as a CLI stdio server
const base = new McpServer({ name: 'faces-mcp', version: '0.0.1' })
const server = createFacesServer(base, {
  list_faces: ({ agentPath }, extra): Promise<CallToolResult> => {
    console.log('list_faces', { agentPath, extra })
    try {
      return Promise.resolve(toStructured({ face_kinds: [] }))
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  create_face: ({ agentPath, faceKind }, extra): Promise<CallToolResult> => {
    console.log('create_face', { agentPath, faceKind, extra })
    try {
      return Promise.resolve(
        toStructured({ faceId: `stub-${crypto.randomUUID()}` }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  read_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('read_face', { agentPath, faceId, extra })
    try {
      return Promise.resolve(
        toStructured({
          status: {
            startedAt: new Date().toISOString(),
            closed: true,
            interactions: 0,
          },
        }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  destroy_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('destroy_face', { agentPath, faceId, extra })
    try {
      return Promise.resolve(
        toStructured({ deleted: false }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
})

const transport = new StdioServerTransport()
await server.connect(transport)
