import {
  createMachine as createFlyMachine,
  getFlyMachine,
  listMachines,
  type MachineDetail,
  type MachineSummary,
} from '@artifact/shared'

import type { AppConfig } from './config.ts'

export const AGENT_METADATA_KEY = 'artifact_agent_id'

export type CreateMachineInput = {
  name: string
  config: Record<string, unknown>
  region?: string
}

export type FlyApi = {
  getMachine: (machineId: string) => Promise<MachineDetail>
  listMachines: () => Promise<MachineSummary[]>
  createMachine: (input: CreateMachineInput) => Promise<MachineSummary>
  startMachine: (machineId: string) => Promise<void>
}

const API_BASE = 'https://api.machines.dev'

export function createFlyApi(
  config: AppConfig,
  fetchImpl: typeof fetch,
): FlyApi {
  return {
    getMachine: (machineId: string) =>
      getFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        machineId,
        fetchImpl,
      }),
    listMachines: () =>
      listMachines({
        appName: config.targetApp,
        token: config.flyApiToken,
        fetchImpl,
      }),
    createMachine: ({ name, config: machineConfig, region }) =>
      createFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        name,
        config: machineConfig,
        region,
        fetchImpl,
      }),
    startMachine: (machineId: string) =>
      startFlyMachine({
        appName: config.targetApp,
        token: config.flyApiToken,
        machineId,
        fetchImpl,
      }),
  }
}

type StartFlyMachineBag = {
  appName: string
  token: string
  machineId: string
  fetchImpl: typeof fetch
}

async function startFlyMachine(
  { appName, token, machineId, fetchImpl }: StartFlyMachineBag,
): Promise<void> {
  const url = `${API_BASE}/v1/apps/${encodeURIComponent(appName)}/machines/${
    encodeURIComponent(machineId)
  }/start`
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  })
  const res = await fetchImpl(url, { method: 'POST', headers })
  if (res.ok) return
  if ([202, 204, 409, 423].includes(res.status)) return
  const body = await res.text().catch(() => '')
  throw new Error(
    `Failed to start machine ${machineId}: ${res.status} ${res.statusText}\n${body}`,
  )
}

export async function safeGetMachine(
  fly: FlyApi,
  machineId: string,
): Promise<MachineDetail | undefined> {
  try {
    return await fly.getMachine(machineId)
  } catch (err) {
    if (err instanceof Error && /Fly API error\s+404/.test(err.message)) {
      return undefined
    }
    throw err
  }
}

export async function ensureMachineRunning(
  detail: MachineDetail,
  fly: FlyApi,
): Promise<void> {
  const state = (detail.state ?? '').toLowerCase()
  if (state === 'started' || state === 'starting') return
  await fly.startMachine(detail.id)
}
