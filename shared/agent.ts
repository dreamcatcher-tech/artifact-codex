export type AgentView = {
  name: string
  port: number
  protocol: 'http'
  url: string
}

export type AgentStatus = {
  startedAt: string
  closed: boolean
  interactions: number
  lastInteractionId?: string
  pid?: number

  home?: string
  workspace?: string
  config?: string

  processExited?: boolean
  exitCode?: number | null
  // Optional notification info (file-based IPC)
  notifications?: number
  lastNotificationRaw?: string
  // Optional views exposed by the face (e.g., web UIs or proxies)
  views?: AgentView[]
}

export type AgentWaitOptions = {
  status?: 'pending' | 'settled'
}

export type Agent = {
  interaction: (id: string, input: string) => void
  awaitInteraction: (
    id: string,
    opts?: AgentWaitOptions,
  ) => Promise<string> | string
  cancel: (id: string) => Promise<void> | void
  destroy: () => Promise<void> | void
  status: () => Promise<AgentStatus> | AgentStatus
}

export type AgentOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to the Face home directory used for app config/cache/scratch. */
  home?: string
  /** Optional hostname hint for agents that expose network views. */
  hostname?: string
  /** Arbitrary configuration map for agent-kind specific options */
  config?: Record<string, unknown>
}
