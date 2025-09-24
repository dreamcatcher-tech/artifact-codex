import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Output schemas aligned with @artifact/agent-basic faces.ts
const faceViewSchema = z.object({
  name: z.string(),
  port: z.number(),
  protocol: z.literal('http'),
  url: z.string(),
})

export const listFacesOutput = z.object({
  face_kinds: z.array(z.object({
    faceKindId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  })),
  live_faces: z.array(z.object({
    faceId: z.string(),
    faceKindId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    views: z.array(faceViewSchema),
  })),
})

export type ListFacesOutput = z.infer<typeof listFacesOutput>

export const createFaceInput = z.object({
  agentId: z.string(),
  faceKindId: z.string(),
  home: z.string().optional(),
  workspace: z.string().optional(),
  hostname: z.string().optional(),
})

export const createFaceOutput = z.object({ faceId: z.string() })

export const readFaceOutput = z.object({
  status: z.object({
    startedAt: z.string(),
    closed: z.boolean(),
    interactions: z.number(),
    lastInteractionId: z.string().optional(),
    pid: z.number().optional(),
    config: z.string().optional(),
    home: z.string().optional(),
    workspace: z.string().optional(),
  }),
  views: z.array(faceViewSchema),
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
  create_face: ToolHandler<{
    agentId: string
    faceKindId: string
    home?: string
    workspace?: string
    hostname?: string
    config?: Record<string, unknown>
  }>
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
      description:
        'Lists available face kinds for a given Agent id. Use "@self" as agentId to target the currently running agent via the local web server. face_kinds are the faces that can be created by calling create_face with the faceKindId.  live_faces are the faces that are currently running, the status of which can be read by calling read_face with the faceId.',
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
        `Creates a Face of the specified kind for the given Agent id. Returns a faceId. Use "@self" as agentId to target your own Agent ID.  Use read_face with the faceId to await the creation of the face and get its status.`,
      inputSchema: createFaceInput.shape,
      outputSchema: createFaceOutput.shape,
    },
    (args, extra) => handlers.create_face(args, extra),
  )

  server.registerTool(
    'read_face',
    {
      title: 'Read Face',
      description:
        'Await the creation of a Face by id for the given Agent id and retrieve its status. Use "@self" as agentId to target your own Agent ID.  This will include the status of the face, the views that are available that may be accessed via a browser url, and the last interaction id if there has been one.',
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
        'Destroys a Face by id for the given Agent id. Returns deleted boolean. Use "@self" as agentId to target the current agent.',
      inputSchema: { agentId: z.string(), faceId: z.string() },
      outputSchema: destroyFaceOutput.shape,
    },
    (args, extra) => handlers.destroy_face(args, extra),
  )

  return server
}
