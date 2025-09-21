import { subdomainToAgent } from '@artifact/shared'

export function resolveHost(request: Request): string | undefined {
  const headers = request.headers
  const candidates = [
    headers.get('fly-original-host'),
    headers.get('x-forwarded-host'),
    headers.get('host'),
  ]
  for (const candidate of candidates) {
    const normalized = normalizeHost(candidate)
    if (normalized) return normalized
  }
  try {
    const url = new URL(request.url)
    return normalizeHost(url.host)
  } catch {
    return undefined
  }
}

export function extractAgentPath(host: string): string[] {
  const firstLabel = host.split('.')[0] ?? ''
  if (!firstLabel) return []
  return subdomainToAgent(firstLabel)
}

function normalizeHost(candidate: string | null): string | undefined {
  if (!candidate) return undefined
  const primary = candidate.split(',')[0]?.trim() ?? ''
  if (!primary) return undefined
  const withoutPort = primary.split(':')[0]?.trim() ?? ''
  return withoutPort ? withoutPort.toLowerCase() : undefined
}
