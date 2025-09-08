import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Shared schemas for tool input/output
export const faceKindSchema = z.object({
  face_kind: z.string(),
  command: z.string(),
  description: z.string(),
})

export const listFacesOutput = z.object({ face_kinds: z.array(faceKindSchema) })
export const createFaceOutput = z.object({ face_id: z.string() })
export const readFaceOutput = z.object({
  exists: z.boolean(),
  face: z
    .object({
      id: z.string(),
      kind: z.string().optional(),
      command: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      agentPath: z.string(),
    })
    .optional(),
  reason: z.string().optional(),
})

export const destroyFaceOutput = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
})

type ToolHandler<I> = (
  input: I,
  // Keep extra loosely typed to avoid leaking SDK internals downstream
  extra: unknown,
) => Promise<CallToolResult> | CallToolResult

export type FacesHandlers = {
  list_faces: ToolHandler<{ agentPath: string }>
  create_face: ToolHandler<{ agentPath: string; faceKind: string }>
  read_face: ToolHandler<{ agentPath: string; faceId: string }>
  destroy_face: ToolHandler<{ agentPath: string; faceId: string }>
}

export type CreateFacesServerOptions = Record<string, never>

/**
 * Register Faces tools on an existing MCP server and return it.
 */
export function createFacesServer(
  server: McpServer,
  impls: FacesHandlers,
  _opts: CreateFacesServerOptions = {},
): McpServer {
  server.registerTool(
    'list_faces',
    {
      title: 'List Faces',
      description:
        'Lists available face kinds for a given Agent path. Returns kind identifier, command, and description.',
      inputSchema: { agentPath: z.string() },
      outputSchema: listFacesOutput.shape,
    },
    (args, extra) => impls.list_faces(args, extra),
  )

  server.registerTool(
    'create_face',
    {
      title: 'Create Face',
      description:
        'Creates a Face of the specified kind for the given Agent path. Returns a face id.',
      inputSchema: { agentPath: z.string(), faceKind: z.string() },
      outputSchema: createFaceOutput.shape,
    },
    (args, extra) => impls.create_face(args, extra),
  )

  server.registerTool(
    'read_face',
    {
      title: 'Read Face',
      description:
        'Reads info about a Face by id for the given Agent path, including status.',
      inputSchema: { agentPath: z.string(), faceId: z.string() },
      outputSchema: readFaceOutput.shape,
    },
    (args, extra) => impls.read_face(args, extra),
  )

  server.registerTool(
    'destroy_face',
    {
      title: 'Destroy Face',
      description:
        'Destroys a Face by id for the given Agent path. Returns ok boolean.',
      inputSchema: { agentPath: z.string(), faceId: z.string() },
      outputSchema: destroyFaceOutput.shape,
    },
    (args, extra) => impls.destroy_face(args, extra),
  )

  return server
}
