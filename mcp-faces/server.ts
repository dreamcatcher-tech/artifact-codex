import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Output schemas aligned with @artifact/web-server faces.ts
export const listFacesOutput = z.object({ face_kinds: z.array(z.string()) })

export const createFaceOutput = z.object({ faceId: z.string() })

export const readFaceOutput = z.object({
  status: z.object({
    startedAt: z.string(),
    closed: z.boolean(),
    interactions: z.number(),
    lastInteractionId: z.string().optional(),
    pid: z.number().optional(),
    config: z.string().optional(),
    workspace: z.string().optional(),
    processExited: z.boolean().optional(),
    exitCode: z.number().nullable().optional(),
    notifications: z.number().optional(),
    lastNotificationRaw: z.string().optional(),
  }),
})

export const destroyFaceOutput = z.object({
  deleted: z.boolean(),
})

type ToolHandler<I> = (
  input: I,
  // Keep extra loosely typed to avoid leaking SDK internals downstream
  extra?: unknown,
) => Promise<CallToolResult> | CallToolResult

export type FacesHandlers = {
  list_faces: ToolHandler<{ agentId: string }>
  create_face: ToolHandler<{ agentId: string; faceKind: string }>
  read_face: ToolHandler<{ agentId: string; faceId: string }>
  destroy_face: ToolHandler<{ agentId: string; faceId: string }>
}

export type CreateFacesServerOptions = Record<string, never>

/**
 * Register Faces tools on an existing MCP server and return it.
 */
export function createFacesServer(
  server: McpServer,
  handlers: FacesHandlers,
): McpServer {
  server.registerTool(
    'list_faces',
    {
      title: 'List Faces',
      description: 'Lists available face kinds for a given Agent id.',
      inputSchema: { agentId: z.string() },
      outputSchema: listFacesOutput.shape,
    },
    (args, extra) => handlers.list_faces(args, extra),
  )

  server.registerTool(
    'create_face',
    {
      title: 'Create Face',
      description:
        'Creates a Face of the specified kind for the given Agent id. Returns a faceId.',
      inputSchema: { agentId: z.string(), faceKind: z.string() },
      outputSchema: createFaceOutput.shape,
    },
    (args, extra) => handlers.create_face(args, extra),
  )

  server.registerTool(
    'read_face',
    {
      title: 'Read Face',
      description: 'Reads status about a Face by id for the given Agent id.',
      inputSchema: { agentId: z.string(), faceId: z.string() },
      outputSchema: readFaceOutput.shape,
    },
    (args, extra) => handlers.read_face(args, extra),
  )

  server.registerTool(
    'destroy_face',
    {
      title: 'Destroy Face',
      description:
        'Destroys a Face by id for the given Agent id. Returns deleted boolean.',
      inputSchema: { agentId: z.string(), faceId: z.string() },
      outputSchema: destroyFaceOutput.shape,
    },
    (args, extra) => handlers.destroy_face(args, extra),
  )

  return server
}
