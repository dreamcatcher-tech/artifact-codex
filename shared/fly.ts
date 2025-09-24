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

const FLY_NOT_FOUND_HINTS = [
  'not found',
  'could not find',
  'does not exist',
  'no such app',
  '404',
]

export function isFlyResourceNotFound(error: unknown): boolean {
  if (error instanceof FlyCommandError) {
    const body = `${error.result.stderr} ${error.result.stdout}`.toLowerCase()
    return FLY_NOT_FOUND_HINTS.some((hint) => body.includes(hint))
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return FLY_NOT_FOUND_HINTS.some((hint) => message.includes(hint))
  }
  return false
}
