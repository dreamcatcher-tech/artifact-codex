import {
  isFlyResourceNotFound,
  type MachineDetail,
  type MachineSummary,
  mapMachineDetail,
  mapMachineSummary,
} from '@artifact/shared'
import {
  flyCliCreateMachine,
  flyCliGetMachine,
  flyCliListMachines,
  flyCliStartMachine,
} from '@artifact/tasks'
import type { CommandExecutor } from '@artifact/tasks'

import type { AppConfig } from './config.ts'

export const AGENT_METADATA_KEY = 'artifact_agent_id'

export type CreateMachineInput = {
  name: string
  config: Record<string, unknown>
  image: string
  region?: string
}

export type FlyApi = {
  getMachine: (machineId: string) => Promise<MachineDetail>
  listMachines: () => Promise<MachineSummary[]>
  createMachine: (input: CreateMachineInput) => Promise<MachineSummary>
  runMachine: (
    input: CreateMachineInput & { detach?: boolean },
  ) => Promise<MachineSummary>
  startMachine: (machineId: string) => Promise<void>
}

export function createFlyApi(
  config: AppConfig,
  commandExecutor?: CommandExecutor,
): FlyApi {
  return {
    getMachine: async (machineId: string) =>
      mapMachineDetail(
        await flyCliGetMachine({
          appName: config.targetApp,
          machineId,
          commandExecutor,
        }),
      ),
    listMachines: async () =>
      (await flyCliListMachines({
        appName: config.targetApp,
        commandExecutor,
      })).map(mapMachineSummary),
    createMachine: async ({ name, config: machineConfig, image, region }) =>
      mapMachineSummary(
        await flyCliCreateMachine({
          appName: config.targetApp,
          name,
          config: machineConfig,
          image,
          region,
          commandExecutor,
        }),
      ),
    runMachine: async (
      { name, config: machineConfig, image, region, detach },
    ) =>
      mapMachineSummary(
        await flyCliMachineRun({
          appName: config.targetApp,
          image,
          config: machineConfig,
          name,
          region,
          detach,
          commandExecutor,
        }),
      ),
    startMachine: (machineId: string) =>
      flyCliStartMachine({
        appName: config.targetApp,
        machineId,
        commandExecutor,
      }),
  }
}

export async function safeGetMachine(
  fly: FlyApi,
  machineId: string,
): Promise<MachineDetail | undefined> {
  try {
    return await fly.getMachine(machineId)
  } catch (err) {
    if (isFlyResourceNotFound(err)) {
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
