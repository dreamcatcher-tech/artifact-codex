/**
 * Global host binding used anywhere we previously hardcoded
 * "127.0.0.1" or "localhost". Override via env `HOST`.
 */
export const HOST: string = (() => {
  try {
    return Deno.env.get('HOST') ?? '127.0.0.1'
  } catch {
    return '127.0.0.1'
  }
})()

export const NFS_MOUNT_DIR = '/mnt/computers'
export const NFS_SHARE_PATH = '/data/computers'
export const COMPUTER_AGENT_CONTAINERS = 'org-agent-containers'

export const COMPUTER_AGENTS = 'agents'
export const COMPUTER_REPOS = 'repos'
export const COMPUTER_EXEC = 'exec'
