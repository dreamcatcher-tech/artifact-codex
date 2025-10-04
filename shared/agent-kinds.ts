export const AGENT_KINDS = [
  {
    id: 'test',
    title: 'Test',
    description: 'A test face',
  },
  {
    id: 'inspector',
    title: 'Inspector',
    description: 'MCP Inspector that presents a web server UI',
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Runs a Codex session and presents it in a ttyd ui',
  },
  {
    id: 'cmd',
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
  },
] as const

export type AgentKind = (typeof AGENT_KINDS)[number]

export type AgentKindId = AgentKind['id']
