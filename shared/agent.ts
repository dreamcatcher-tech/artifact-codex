export type AgentView = {
  name: string
  port: number
  protocol: 'http'
  url: string
}

export type AgentOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to the Face home directory used for app config/cache/scratch. */
  home?: string
  /** Arbitrary configuration map for agent-kind specific options */
  config?: Record<string, unknown>
}
