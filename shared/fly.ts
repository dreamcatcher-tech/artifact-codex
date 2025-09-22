import { FlyCommandError } from '@artifact/tasks'
import type { FlyCliMachineDetail, FlyCliMachineSummary } from '@artifact/tasks'

export type MachineSummary = {
  id: string
  name?: string
  state?: string
  region?: string
  image?: string
  ip?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type MachineDetail = MachineSummary & {
  config?: Record<string, unknown>
}

export function mapMachineSummary(
  summary: FlyCliMachineSummary,
): MachineSummary {
  return {
    id: summary.id,
    name: summary.name,
    state: summary.state,
    region: summary.region,
    image: summary.image,
    ip: summary.privateIp,
    createdAt: summary.createdAt,
    metadata: summary.metadata,
  }
}

export function mapMachineDetail(detail: FlyCliMachineDetail): MachineDetail {
  return {
    ...mapMachineSummary(detail),
    config: detail.config,
  }
}

export function isFlyResourceNotFound(error: unknown): boolean {
  if (error instanceof FlyCommandError) {
    const body = `${error.result.stderr} ${error.result.stdout}`.toLowerCase()
    return body.includes('not found') || body.includes('404')
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('not found') || message.includes('404')
  }
  return false
}
