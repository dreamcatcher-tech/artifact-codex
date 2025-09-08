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

export type Face = {
  interaction: (input: string) => { id: string; value: string }
  close: () => Promise<void>
  status: () => Promise<FaceStatus>
}

export type FaceOptions = {
  /** Absolute path to a workspace directory (CWD for child processes). */
  workspace?: string
  /** Absolute path to a config directory used for app config/cache/scratch. */
  config?: string
}
