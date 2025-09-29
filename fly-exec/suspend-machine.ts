import { type ClientOptions, FlyIoClient } from '@alexarena/fly-io-client'
import { readFlyMachineRuntimeEnv } from '@artifact/shared'
import Debug from 'debug'

type SuspendResponse = void

const log = Debug('@artifact/fly-exec:suspend-machine')

const createClient = (token?: string) => {
  const options: ClientOptions = {
    apiKey: token,
    maxRetries: 30,
  }
  return new FlyIoClient(options)
}

type Options = {
  FLY_APP_NAME?: string
  FLY_MACHINE_ID?: string
}

export const suspendCurrentMachine = async (
  options: Options = {},
): Promise<SuspendResponse> => {
  const appName = options.FLY_APP_NAME ||
    readFlyMachineRuntimeEnv()['FLY_APP_NAME']
  const machineId = options.FLY_MACHINE_ID ||
    readFlyMachineRuntimeEnv()['FLY_MACHINE_ID']

  log('suspending current machine', { appName, machineId })
  const client = createClient()

  try {
    await client.apps.machines.suspend(machineId, { app_name: appName })
    log('machine suspended', { appName, machineId })
    return
  } catch (error) {
    log('suspend failed', error)
    if (error instanceof Error) {
      throw new Error(
        `Failed to suspend machine ${machineId}: ${error.message}`,
        {
          cause: error,
        },
      )
    }
    throw error
  }
}

export type { SuspendResponse }
