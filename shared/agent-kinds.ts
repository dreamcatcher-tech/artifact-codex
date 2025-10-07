export const AGENT_KINDS = [
  {
    id: 'test',
    title: 'Test',
    description: 'A test face',
    command: ['deno', 'run', '-A', 'agent-test/main.ts'],
  },
  {
    id: 'inspector',
    title: 'Inspector',
    description: 'MCP Inspector that presents a web server UI',
    command: ['deno', 'run', '-A', 'agent-inspector/main.ts'],
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Runs a Codex session and presents it in a ttyd ui',
    command: ['deno', 'run', '-A', 'agent-codex/main.ts'],
  },
  {
    id: 'cmd',
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
    command: ['deno', 'run', '-A', 'agent-cmd/main.ts'],
  },
] as const

export type AgentKind = (typeof AGENT_KINDS)[number]

export type AgentKindId = AgentKind['id']
