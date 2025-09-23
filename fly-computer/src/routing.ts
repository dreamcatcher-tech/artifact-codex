import {
  agentToSubdomain,
  subdomainToAgent,
  PATH_SEPARATOR,
} from '@artifact/shared'

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

export type HostResolution = {
  computer: string | null
  agentPath: string[]
}

export function resolveComputerHost(
  host: string,
  baseDomain: string,
): HostResolution | null {
  const hostLabels = splitLabels(host)
  const baseLabels = splitLabels(baseDomain)
  if (hostLabels.length < baseLabels.length) return null
  const suffixMatches = baseLabels.every((label, idx) =>
    hostLabels[hostLabels.length - baseLabels.length + idx]?.toLowerCase() ===
      label.toLowerCase()
  )
  if (!suffixMatches) {
    return null
  }
  const remainder = hostLabels.slice(0, hostLabels.length - baseLabels.length)
  if (remainder.length === 0) {
    return { computer: null, agentPath: [] }
  }

  const labelsBeforeCombined = remainder.slice(0, -1)
  const combinedLabel = remainder[remainder.length - 1] ?? ''

  const agentPath: string[] = []
  for (const label of labelsBeforeCombined) {
    agentPath.push(...subdomainToAgent(label))
  }

  const combinedSegments = subdomainToAgent(combinedLabel)
  if (combinedSegments.length === 0) {
    return null
  }
  const computer = combinedSegments.pop()!
  if (!computer) return null
  agentPath.push(...combinedSegments)

  return { computer, agentPath }
}

export function buildAgentHost(
  agentPath: string[],
  computer: string,
  baseDomain: string,
): string {
  const prefix = agentPath.length > 0
    ? `${agentToSubdomain(agentPath)}${PATH_SEPARATOR}${computer}`
    : computer
  return `${prefix}.${baseDomain}`
}

function normalizeHost(candidate: string | null): string | undefined {
  if (!candidate) return undefined
  const primary = candidate.split(',')[0]?.trim() ?? ''
  if (!primary) return undefined
  const withoutPort = primary.split(':')[0]?.trim() ?? ''
  return withoutPort ? withoutPort.toLowerCase() : undefined
}

function splitLabels(input: string): string[] {
  return input
    .split('.')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
}
