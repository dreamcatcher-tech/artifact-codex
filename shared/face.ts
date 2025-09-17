export type FaceView = {
  name: string
  port: number
  protocol: 'http'
  url: string
}

export type FaceStatus = {
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
  views?: FaceView[]
}

export type FaceWaitOptions = {
  status?: 'pending' | 'settled'
}

export type Face = {
  interaction: (id: string, input: string) => void
  awaitInteraction: (
    id: string,
    opts?: FaceWaitOptions,
  ) => Promise<string> | string
  cancel: (id: string) => Promise<void> | void
  destroy: () => Promise<void> | void
  status: () => Promise<FaceStatus> | FaceStatus
}

export type FaceOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to the Face home directory used for app config/cache/scratch. */
  home?: string
  /**
   * External hostname to use when generating URLs for views exposed by the face.
   * Useful when running behind a reverse proxy so links are correct for users.
   */
  hostname?: string
  /** Arbitrary configuration map for face-kind specific options */
  config?: Record<string, unknown>
}
