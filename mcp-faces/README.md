This is a Stdio MCP server exposing Face management for Agents.

- Face: a runnable presentation/interaction surface bound to an Agent.

Tools

- `list_faces(agentPath)`: Lists available face kinds for a given Agent path.
  Returns `{ face_kinds: [{ face_kind, command, description }] }`.
- `create_face(agentPath, faceKind)`: Creates a Face of the given kind for the
  specified Agent. Returns `{ face_id }`.
- `read_face(agentPath, faceId)`: Reads info about an existing Face, including
  status. Returns `{ exists, face? }`.
- `destroy_face(agentPath, faceId)`: Destroys the Face. Returns `{ ok }`.

Implementation is stubbed pending integration with Agents/Computers.
