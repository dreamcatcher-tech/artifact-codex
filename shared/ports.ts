import { HOST } from './consts.ts'
import {
  checkPort as portFreeCheckPort,
  defaults as portFreeDefaults,
  getPort as portFreeGetPort,
  type PortOptions,
} from '@openjs/port-free'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveProbeHosts(hostname?: string): string[] {
  const target = hostname ?? HOST
  if (!target || target === '0.0.0.0') return ['127.0.0.1']
  if (target === '::') return ['::1']
  return [target]
}

async function isPortFreeOnHosts(
  port: number,
  hosts: string[],
): Promise<boolean> {
  for (const host of hosts) {
    if (!await portFreeCheckPort(port, host)) return false
  }
  return true
}

async function isPortListening(
  hosts: string[],
  port: number,
): Promise<boolean> {
  for (const host of hosts) {
    try {
      const conn = await Deno.connect({ hostname: host, port })
      try {
        conn.close()
      } catch {
        // ignore
      }
      return true
    } catch {
      // ignore
    }
  }
  return false
}

export interface PortRequestOptions extends PortOptions {
  hostname?: string
  retryLimit?: number
}

export async function findAvailablePort(
  options: PortRequestOptions = {},
): Promise<number> {
  const { hostname, retryLimit, ...portOptions } = options
  const hosts = resolveProbeHosts(hostname)
  const exclude = new Set<number>(portOptions.exclude ?? [])
  const min = portOptions.min ?? portFreeDefaults.min
  const max = portOptions.max ?? portFreeDefaults.max
  const maxAttempts = retryLimit ?? Math.max(100, max - min + 1)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await portFreeGetPort({
      ...portOptions,
      exclude: [...exclude],
    })
    if (await isPortFreeOnHosts(candidate, hosts)) {
      return candidate
    }
    exclude.add(candidate)
  }

  throw new Error(
    `Unable to find an available port between ${min} and ${max} for hosts ${
      hosts.join(', ')
    }`,
  )
}

export async function findAvailablePorts(
  count: number,
  options: PortRequestOptions = {},
): Promise<number[]> {
  if (count < 1) {
    throw new Error('count must be at least 1')
  }
  const ports: number[] = []
  const exclude = new Set<number>(options.exclude ?? [])
  while (ports.length < count) {
    const port = await findAvailablePort({
      ...options,
      exclude: [...exclude],
    })
    ports.push(port)
    exclude.add(port)
  }
  return ports
}

export interface WaitForPortOptions {
  hostname?: string
  timeoutMs?: number
  intervalMs?: number
}

export async function waitForPort(
  port: number,
  options: WaitForPortOptions = {},
): Promise<boolean> {
  const { hostname, timeoutMs = 5000, intervalMs = 50 } = options
  const hosts = resolveProbeHosts(hostname)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isPortListening(hosts, port)) return true
    await delay(intervalMs)
  }
  return false
}

export async function waitForPorts(
  ports: number[],
  options: WaitForPortOptions = {},
): Promise<boolean> {
  const pending = new Set(ports)
  if (pending.size === 0) return true
  const { hostname, timeoutMs = 60_000, intervalMs = 100 } = options
  const hosts = resolveProbeHosts(hostname)
  const start = Date.now()
  while (pending.size > 0 && Date.now() - start < timeoutMs) {
    for (const port of Array.from(pending)) {
      if (await isPortListening(hosts, port)) {
        pending.delete(port)
      }
    }
    if (pending.size === 0) return true
    await delay(intervalMs)
  }
  return pending.size === 0
}

export { resolveProbeHosts }
