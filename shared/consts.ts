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
