import type { CreateAgentWebServerOptions, FaceKindConfig } from './mod.ts'
import { startFaceTest } from '@artifact/face-test'
import { startFaceInspector } from '@artifact/face-inspector'
import { startFaceCodex } from '@artifact/face-codex'
import { startFaceCmd } from '@artifact/face-cmd'

const DEFAULT_FACE_KINDS: FaceKindConfig[] = [
  {
    id: 'test',
    title: 'Test',
    description: 'A test face',
    create: startFaceTest,
  },
  {
    id: 'inspector',
    title: 'Inspector',
    description: 'MCP Inspector that presents a web server UI',
    create: startFaceInspector,
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Runs a Codex session and presents it in a ttyd ui',
    create: startFaceCodex,
  },
  {
    id: 'cmd',
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
    create: startFaceCmd,
  },
]

export function createTestServerOptions(
  overrides: Partial<CreateAgentWebServerOptions> = {},
): CreateAgentWebServerOptions {
  const faceKinds = overrides.faceKinds ?? DEFAULT_FACE_KINDS
  return {
    serverName: overrides.serverName ?? 'web-server-test',
    serverVersion: overrides.serverVersion ?? '0.0.1',
    faceKinds,
    defaultFaceKindId: overrides.defaultFaceKindId ?? 'codex',
    defaultFaceAgentId: overrides.defaultFaceAgentId ?? '@self',
    debugNamespace: overrides.debugNamespace ?? '@artifact/web-server:test',
  }
}

export const DEFAULT_FACE_KIND_IDS = DEFAULT_FACE_KINDS.map((kind) => kind.id)
