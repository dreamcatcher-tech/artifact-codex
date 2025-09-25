import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from 'unique-names-generator'

export function deriveBaseName(input: string): string {
  return input.replace(/-(\d+)$/, '')
}

export function nextIndexForName(
  names: Array<string | undefined>,
  base: string,
): number {
  let max = -1
  for (const n of names) {
    if (!n) continue
    if (!n.startsWith(base + '-')) continue
    const rest = n.slice(base.length + 1)
    if (/^\d+$/.test(rest)) {
      const idx = parseInt(rest, 10)
      if (Number.isFinite(idx)) max = Math.max(max, idx)
    }
  }
  return max + 1
}

function randomFourDigits(): string {
  const bucket = new Uint16Array(1)
  while (true) {
    crypto.getRandomValues(bucket)
    const value = bucket[0]
    if (value < 10000) return value.toString().padStart(4, '0')
  }
}

export function generateFlyMachineName(): string {
  const words = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    length: 2,
    separator: '-',
    style: 'lowerCase',
  })
  return `${words}-${randomFourDigits()}`
}

export const PATH_SEPARATOR = '--'
const DNS_SEGMENT_PATTERN = /^[a-z0-9-]+$/

function normalizeSubdomainSegment(input: string): string {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return ''
  const cleaned = normalized.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
  const trimmed = cleaned.replace(/^-+|-+$/g, '')
  return trimmed
}

function assertValidAgentSegment(segment: string): void {
  if (segment.length === 0) {
    throw new Error('Agent names cannot be empty')
  }
  if (segment.includes(PATH_SEPARATOR)) {
    throw new Error('Agent names cannot include the path separator')
  }
  if (!DNS_SEGMENT_PATTERN.test(segment)) {
    throw new Error('Agent names must match lowercase DNS label rules')
  }
  if (segment.startsWith('-') || segment.endsWith('-')) {
    throw new Error('Agent names cannot start or end with a hyphen')
  }
  if (segment.length > 63) {
    throw new Error('Agent names must be 63 characters or fewer')
  }
}

export function agentToSubdomain(path: string[]): string {
  if (path.length === 0) {
    throw new Error('Agent path must include at least one segment')
  }

  const segments: string[] = []
  for (const segment of path) {
    assertValidAgentSegment(segment)
    segments.push(segment)
  }

  const subdomain = segments.join(PATH_SEPARATOR)
  if (subdomain.length > 63) {
    throw new Error('Combined agent path exceeds DNS label length')
  }
  return subdomain
}

export function subdomainToAgent(subdomain: string): string[] {
  const normalized = subdomain.trim().toLowerCase()
  if (!normalized) return []
  return normalized.split(PATH_SEPARATOR)
    .map(normalizeSubdomainSegment)
    .filter((segment) => segment.length > 0)
}
