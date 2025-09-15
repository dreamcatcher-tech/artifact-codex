import { HonoRequest } from '@hono/hono'

function parsePort(v: string | undefined): number | null {
  if (!v) return null
  if (!/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 65535 ? n : null
}

export function portFromHeaders(req: HonoRequest): number | null {
  return parsePort(req.header('fly-forwarded-port'))
}
