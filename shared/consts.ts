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

export const FLY_NFS_MOUNT_DIR = '/mnt/computers'
export const NFS_EXPORT_BASE = '/data'
export const FLY_NFS_SUBPATH = 'computers'
