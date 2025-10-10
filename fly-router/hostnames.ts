function normalizeHostname(value: string): string {
  return value.toLowerCase()
}

export function assertHostname(hostname: string, baseDomain: string): void {
  const normalizedHostname = normalizeHostname(hostname)
  const normalizedBaseDomain = normalizeHostname(baseDomain)

  if (normalizedHostname === normalizedBaseDomain) {
    return
  }
  if (!normalizedHostname.endsWith(`.${normalizedBaseDomain}`)) {
    throw new Error(`hostname mismatch: ${hostname} !endsWith ${baseDomain}`)
  }
}

export function isBaseDomain(urlString: string, baseDomain: string): boolean {
  const url = new URL(urlString)
  assertHostname(url.hostname, baseDomain)
  return normalizeHostname(url.hostname) === normalizeHostname(baseDomain)
}

export function getSubdomain(urlString: string, baseDomain: string): string {
  const url = new URL(urlString)
  assertHostname(url.hostname, baseDomain)
  const normalizedHostname = normalizeHostname(url.hostname)
  const normalizedBaseDomain = normalizeHostname(baseDomain)
  const rawSubdomain = normalizedHostname.slice(0, -normalizedBaseDomain.length)
  const subdomain = rawSubdomain.endsWith('.')
    ? rawSubdomain.slice(0, -1)
    : rawSubdomain
  if (!subdomain) {
    throw new Error('subdomain is empty')
  }
  if (subdomain.includes('.')) {
    throw new Error('subdomain contains a dot')
  }
  const split = subdomain.split('--')
  if (split.length > 2) {
    throw new Error('subdomain does not contain exactly one --')
  }
  return subdomain
}

export function getComputerId(urlString: string, baseDomain: string): string {
  const subdomain = getSubdomain(urlString, baseDomain)
  if (!subdomain.includes('--')) {
    return subdomain
  }
  return subdomain.split('--')[1]
}

export function getAgentId(urlString: string, baseDomain: string): string {
  const subdomain = getSubdomain(urlString, baseDomain)
  if (!subdomain.includes('--')) {
    throw new Error('subdomain does not contain agent id')
  }
  return subdomain.split('--')[0]
}

export function isComputerDomain(
  urlString: string,
  baseDomain: string,
): boolean {
  const subdomain = getSubdomain(urlString, baseDomain)

  if (subdomain.includes('--')) {
    return false
  }
  return true
}

export function isAgentDomain(urlString: string, baseDomain: string): boolean {
  const subdomain = getSubdomain(urlString, baseDomain)
  if (!subdomain.includes('--')) {
    throw new Error('subdomain does not contain --')
  }
  return true
}
