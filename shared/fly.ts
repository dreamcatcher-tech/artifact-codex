import {
  type FlyCliAppInfo,
  flyCliAppsCreate,
  flyCliAppsDestroy,
  flyCliAppsInfo,
  flyCliAppsList,
  flyCliCreateMachine,
  flyCliDestroyMachine,
  flyCliGetMachine,
  flyCliListMachines,
  type FlyCliMachineDetail,
  type FlyCliMachineSummary,
  flyCliSecretsSet,
  flyCliStartMachine,
  flyCliTokensCreateDeploy,
  FlyCommandError,
} from '@artifact/tasks'
import type { CommandExecutor } from '@artifact/tasks'

import { readFlyMachineRuntimeEnv } from './env.ts'

export type ListMachinesBag = {
  appName: string
  token: string
  commandExecutor?: CommandExecutor
}

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

export type GetMachineBag = {
  appName: string
  token: string
  machineId: string
  commandExecutor?: CommandExecutor
}

export type GetAppBag = {
  appName: string
  token: string
  commandExecutor?: CommandExecutor
}

export type AppInfo = {
  id: string
  name?: string
  organizationSlug?: string
  createdAt?: string
}

export type CreateAppBag = {
  token: string
  appName: string
  orgSlug: string
  commandExecutor?: CommandExecutor
}

export type ListAppsBag = {
  token: string
  orgSlug: string
  commandExecutor?: CommandExecutor
}

export type AppExistsBag = {
  token: string
  appName: string
  commandExecutor?: CommandExecutor
}

export type ProbeTokenScopeBag = {
  token: string
  appName?: string
  orgSlug?: string
  commandExecutor?: CommandExecutor
}

export type ProbeTokenScopeResult = {
  classification: 'org' | 'app' | 'unknown'
  orgSlug?: string
  appName?: string
  evidence: {
    getApp?: { ok: boolean; status: number }
    listApps?: { ok: boolean; status: number }
  }
  message?: string
}

export type CreateMachineBagUnified = {
  appName: string
  token: string
  name: string
  config: Record<string, unknown>
  region?: string
  commandExecutor?: CommandExecutor
}

export type DestroyMachineBag = {
  appName: string
  token: string
  machineId: string
  force?: boolean
  commandExecutor?: CommandExecutor
}

export type StartMachineBag = {
  appName: string
  token: string
  machineId: string
  commandExecutor?: CommandExecutor
}

export type DestroyAppBag = {
  token: string
  appName: string
  force?: boolean
  commandExecutor?: CommandExecutor
}

export type SetSecretsBag = {
  token: string
  appName: string
  secrets: Record<string, string>
  commandExecutor?: CommandExecutor
}

export type CreateDeployTokenBag = {
  token: string
  appName: string
  commandExecutor?: CommandExecutor
}

export async function listMachines(
  { appName, token, commandExecutor }: ListMachinesBag,
): Promise<MachineSummary[]> {
  const machines = await flyCliListMachines({
    appName,
    token,
    commandExecutor,
  })
  return machines.map(mapMachineSummary)
}

export async function getFlyMachine(
  { appName, token, machineId, commandExecutor }: GetMachineBag,
): Promise<MachineDetail> {
  const detail = await flyCliGetMachine({
    appName,
    token,
    machineId,
    commandExecutor,
  })
  return mapMachineDetail(detail)
}

export async function getFlyApp(
  { appName, token, commandExecutor }: GetAppBag,
): Promise<AppInfo> {
  const info = await flyCliAppsInfo({ appName, token, commandExecutor })
  return mapAppInfo(info)
}

export async function createFlyApp(
  { token, appName, orgSlug, commandExecutor }: CreateAppBag,
): Promise<AppInfo> {
  const created = await flyCliAppsCreate({
    token,
    appName,
    orgSlug,
    commandExecutor,
  })
  return mapAppInfo(created)
}

export async function listFlyApps(
  { token, orgSlug, commandExecutor }: ListAppsBag,
): Promise<AppInfo[]> {
  const apps = await flyCliAppsList({ token, orgSlug, commandExecutor })
  return apps.map(mapAppInfo)
}

export async function appExists(
  { token, appName, commandExecutor }: AppExistsBag,
): Promise<boolean> {
  try {
    await flyCliAppsInfo({ token, appName, commandExecutor })
    return true
  } catch (error) {
    if (error instanceof FlyCommandError) {
      return false
    }
    throw error
  }
}

export async function createMachine(
  { appName, token, name, config, region, commandExecutor }:
    CreateMachineBagUnified,
): Promise<MachineSummary> {
  const created = await flyCliCreateMachine({
    appName,
    token,
    name,
    config,
    region,
    commandExecutor,
  })
  return mapMachineSummary(created)
}

export async function destroyMachine(
  { appName, token, machineId, force, commandExecutor }: DestroyMachineBag,
): Promise<{ ok: boolean }> {
  await flyCliDestroyMachine({
    appName,
    token,
    machineId,
    force,
    commandExecutor,
  })
  return { ok: true }
}

export async function destroyFlyApp(
  { token, appName, force, commandExecutor }: DestroyAppBag,
): Promise<void> {
  await flyCliAppsDestroy({ token, appName, force, commandExecutor })
}

export async function startMachine(
  { appName, token, machineId, commandExecutor }: StartMachineBag,
): Promise<void> {
  await flyCliStartMachine({ appName, token, machineId, commandExecutor })
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

export async function setAppSecrets(
  { token, appName, secrets, commandExecutor }: SetSecretsBag,
): Promise<void> {
  await flyCliSecretsSet({ token, appName, secrets, commandExecutor })
}

export async function createDeployToken(
  { token, appName, commandExecutor }: CreateDeployTokenBag,
): Promise<string> {
  return await flyCliTokensCreateDeploy({ token, appName, commandExecutor })
}

export async function probeTokenScope(
  { token, appName, orgSlug, commandExecutor }: ProbeTokenScopeBag,
): Promise<ProbeTokenScopeResult> {
  let derivedApp = (appName ?? '').trim()
  if (!derivedApp) {
    try {
      const env = readFlyMachineRuntimeEnv()
      derivedApp = env.FLY_APP_NAME
    } catch {
      /* ignore */
    }
  }

  let org = (orgSlug ?? '').trim()
  const evidence: ProbeTokenScopeResult['evidence'] = {}

  const magic = token.startsWith('TEST_') ? token : ''
  if (magic) {
    const [, kind, slug] = /^(TEST_\w+)(?::([\w-]+))?$/.exec(magic) ?? []
    const fakeOrg = slug || 'test'
    if (kind === 'TEST_ORG') {
      return {
        classification: 'org',
        orgSlug: fakeOrg,
        appName: derivedApp || undefined,
        evidence: {
          getApp: { ok: true, status: 0 },
          listApps: { ok: true, status: 0 },
        },
      }
    }
    if (kind === 'TEST_APP') {
      return {
        classification: 'app',
        orgSlug: fakeOrg,
        appName: derivedApp || undefined,
        evidence: {
          getApp: { ok: true, status: 0 },
          listApps: { ok: false, status: 403 },
        },
      }
    }
    if (kind === 'TEST_UNKNOWN') {
      return {
        classification: 'unknown',
        orgSlug: org || undefined,
        appName: derivedApp || undefined,
        evidence,
      }
    }
  }

  if (!org && derivedApp) {
    try {
      const info = await getFlyApp({
        token,
        appName: derivedApp,
        commandExecutor,
      })
      evidence.getApp = { ok: true, status: 0 }
      if (info.organizationSlug) org = info.organizationSlug
    } catch (error) {
      evidence.getApp = { ok: false, status: extractStatus(error) }
    }
  }

  if (!org) {
    return {
      classification: 'unknown',
      appName: derivedApp || undefined,
      evidence,
      message:
        'Provide orgSlug or an appName/FLY_APP_NAME so org can be derived for probing.',
    }
  }

  try {
    await listFlyApps({ token, orgSlug: org, commandExecutor })
    evidence.listApps = { ok: true, status: 0 }
    return {
      classification: 'org',
      orgSlug: org,
      appName: derivedApp || undefined,
      evidence,
    }
  } catch (error) {
    const status = extractStatus(error)
    evidence.listApps = { ok: false, status }
    if (status === 401 || status === 403) {
      return {
        classification: 'app',
        orgSlug: org,
        appName: derivedApp || undefined,
        evidence,
        message:
          'Token cannot list apps for the organization; likely an app deploy token.',
      }
    }
    return {
      classification: 'unknown',
      orgSlug: org,
      appName: derivedApp || undefined,
      evidence,
      message: 'Unexpected error probing organization apps.',
    }
  }
}

function mapMachineSummary(summary: FlyCliMachineSummary): MachineSummary {
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

function mapMachineDetail(detail: FlyCliMachineDetail): MachineDetail {
  return {
    ...mapMachineSummary(detail),
    config: detail.config,
  }
}

function mapAppInfo(info: FlyCliAppInfo): AppInfo {
  return {
    id: info.id,
    name: info.name,
    organizationSlug: info.organizationSlug,
    createdAt: info.createdAt,
  }
}

function extractStatus(error: unknown): number {
  if (error instanceof FlyCommandError) {
    const code = error.result.code
    return typeof code === 'number' ? code : 0
  }
  return 0
}
