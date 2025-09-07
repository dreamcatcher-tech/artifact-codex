#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { toError, toStructured } from '@artifact/shared'
import { createFacesServer } from './server.ts'

// Export the factory for library consumers
export { createFacesServer } from './server.ts'

// Default stub implementations used when running as a CLI stdio server
const server = createFacesServer({
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
        toStructured({ face_id: `stub-${crypto.randomUUID()}` }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  read_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('read_face', { agentPath, faceId, extra })
    try {
      return Promise.resolve(
        toStructured({ exists: false, reason: 'Not implemented' }),
      )
    } catch (err) {
      return Promise.resolve(toError(err))
    }
  },
  destroy_face: ({ agentPath, faceId }, extra): Promise<CallToolResult> => {
    console.log('destroy_face', { agentPath, faceId, extra })
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
