export type FaceStatus = {
  startedAt: string
  closed: boolean
  interactions: number
  lastInteractionId?: string
  pid?: number
  // Generic directory names
  config?: string
  workspace?: string
  processExited?: boolean
  exitCode?: number | null
  // Optional notification info (file-based IPC)
  notifications?: number
  lastNotificationRaw?: string
}

export type FaceWaitOptions = {
  status?: 'pending' | 'settled'
}

export type FaceWaitResult<T = unknown> = { error: true } | { result: T }

export type Face = {
  interaction: (input: string) => { id: string }
  waitFor: (
    id: string,
    opts?: FaceWaitOptions,
  ) => Promise<FaceWaitResult>
  cancel: (id: string) => Promise<void>
  destroy: () => Promise<void>
  status: () => Promise<FaceStatus>
}

export type FaceOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to the Face home directory used for app config/cache/scratch. */
  home?: string
  /** Arbitrary configuration map for face-specific options (e.g., runnerApp, flags). */
  config?: Record<string, unknown>
}
