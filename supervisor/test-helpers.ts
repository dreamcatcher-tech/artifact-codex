import Debug from 'debug'
import type { AgentWebServerOptions, FaceKindConfig } from './mod.ts'
import { startAgentTest } from '@artifact/agent-test'
import { startAgentInspector } from '@artifact/agent-inspector'
import { startAgentCodex } from '@artifact/agent-codex'
import { startAgentCmd } from '@artifact/agent-cmd'

const DEFAULT_FACE_KINDS: FaceKindConfig[] = [
  {
    id: 'test',
    title: 'Test',
    description: 'A test face',
    create: startAgentTest,
  },
  {
    id: 'inspector',
    title: 'Inspector',
    description: 'MCP Inspector that presents a web server UI',
    create: startAgentInspector,
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Runs a Codex session and presents it in a ttyd ui',
    create: startAgentCodex,
  },
  {
    id: 'cmd',
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
    create: startAgentCmd,
  },
]

export function createTestServerOptions(
  overrides: Partial<AgentWebServerOptions> = {},
): AgentWebServerOptions {
  const faceKinds = overrides.faceKinds ?? DEFAULT_FACE_KINDS
  const log = overrides.log ?? Debug('@artifact/supervisor:test')
  const timeoutMs = overrides.timeoutMs ?? 60_000
  const onIdle = overrides.onIdle ?? (() => {})
  return {
    serverName: overrides.serverName ?? 'supervisor-test',
    serverVersion: overrides.serverVersion ?? '0.0.1',
    faceKinds,
    log,
    timeoutMs,
    onIdle,
  }
}

export const DEFAULT_FACE_KIND_IDS = DEFAULT_FACE_KINDS.map((kind) => kind.id)
