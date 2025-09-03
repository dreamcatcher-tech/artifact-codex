export type ListMachinesBag = {
  appName: string
  token: string
  fetchImpl?: typeof fetch // allow mocking
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

type RawMachine = {
  id: string
  name?: string
  state?: string
  region?: string
  'image_ref'?: { repository?: string }
  'private_ip'?: string | null
  'created_at'?: string
  config?: Record<string, unknown> | null
}

// legacy create bag removed; use CreateMachineBagUnified below

export type GetMachineBag = {
  appName: string
  token: string
  machineId: string
  fetchImpl?: typeof fetch
}

export type MachineDetail = MachineSummary & {
  config?: Record<string, unknown>
}

export type GetAppBag = {
  appName: string
  token: string
  fetchImpl?: typeof fetch
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
  fetchImpl?: typeof fetch
}

export type ListAppsBag = {
  token: string
  orgSlug?: string
  fetchImpl?: typeof fetch
}

export type AppExistsBag = {
  token: string
  appName: string
  fetchImpl?: typeof fetch
}

// legacy create-with-config bag removed; use CreateMachineBagUnified below

// Single list API surface that also surfaces metadata (if present)

const API_BASE = 'https://api.machines.dev'

function mergeHeaders(
  base: HeadersInit,
  extra?: HeadersInit,
): Headers {
  const h = new Headers(base)
  if (extra) {
    new Headers(extra).forEach((v, k) => h.set(k, v))
  }
  return h
}

async function flyApiFetch(
  path: string,
  token: string,
  init: RequestInit = {},
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const fx = fetchImpl ?? fetch
  const url = `${API_BASE}${path}`
  const headers = mergeHeaders(
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    init.headers ?? {},
  )
  const res = await fx(url, { ...init, headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Fly API error ${res.status}: ${res.statusText}\n${body}`)
  }
  return res
}

function mapRawMachineToSummary(m: RawMachine): MachineSummary {
  // Prefer the canonical config.image when present; it’s deployable as-is.
  const cfgImage = (m.config as { image?: string } | null | undefined)?.image

  let resolvedImage: string | undefined = cfgImage && cfgImage.trim()
    ? cfgImage
    : undefined

  if (!resolvedImage && m.image_ref) {
    const repository = m.image_ref.repository
    // Some API variants place a fully-qualified value in repository. If it
    // already includes a tag or registry, use it as-is.
    if (repository && /[:@]/.test(repository)) {
      resolvedImage = repository
    } else if (repository) {
      // If only repository is present without tag, still surface it — callers
      // may pair it with a tag/digest they track elsewhere.
      resolvedImage = repository
    }
  }

  return {
    id: m.id,
    name: m.name,
    state: m.state,
    region: m.region,
    image: resolvedImage,
    ip: m.private_ip ?? undefined,
    createdAt: m.created_at ?? undefined,
    metadata:
      (m.config as { metadata?: Record<string, unknown> } | null | undefined)
        ?.metadata,
  }
}

export async function listMachines({
  appName,
  token,
  fetchImpl,
}: ListMachinesBag): Promise<MachineSummary[]> {
  const res = await flyApiFetch(
    `/v1/apps/${encodeURIComponent(appName)}/machines`,
    token,
    {},
    fetchImpl,
  )
  const data = await res.json()
  const machines: RawMachine[] = Array.isArray(data)
    ? (data as RawMachine[])
    : ((data?.machines ?? []) as RawMachine[])
  return machines.map(mapRawMachineToSummary)
}

// legacy createFlyMachine removed; use createMachine

export async function getFlyMachine({
  appName,
  token,
  machineId,
  fetchImpl,
}: GetMachineBag): Promise<MachineDetail> {
  const res = await flyApiFetch(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${
      encodeURIComponent(machineId)
    }`,
    token,
    {},
    fetchImpl,
  )
  const m: RawMachine & { config?: Record<string, unknown> } = await res.json()
  const summary = mapRawMachineToSummary(m)
  return { ...summary, config: m.config ?? undefined }
}

export async function getFlyApp({
  appName,
  token,
  fetchImpl,
}: GetAppBag): Promise<AppInfo> {
  const res = await flyApiFetch(
    `/v1/apps/${encodeURIComponent(appName)}`,
    token,
    {},
    fetchImpl,
  )
  const data = await res.json() as
    | {
      id: string
      name?: string
      organization?: { slug?: string }
      created_at?: string
    }
    | null
    | undefined
  return {
    id: data?.id ?? '',
    name: data?.name,
    organizationSlug: data?.organization?.slug,
    createdAt: data?.created_at,
  }
}

export async function createFlyApp({
  token,
  appName,
  orgSlug,
  fetchImpl,
}: CreateAppBag): Promise<AppInfo> {
  const body = {
    'app_name': appName,
    'org_slug': orgSlug,
  }
  const res = await flyApiFetch(
    `/v1/apps`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  const data = await res.json() as {
    id: string
    name?: string
    organization?: { slug?: string }
    created_at?: string
  }
  return {
    id: data.id,
    name: data.name,
    organizationSlug: data.organization?.slug,
    createdAt: data.created_at,
  }
}

export async function listFlyApps({
  token,
  orgSlug,
  fetchImpl,
}: ListAppsBag): Promise<AppInfo[]> {
  const qs = orgSlug ? `?org_slug=${encodeURIComponent(orgSlug)}` : ''
  const res = await flyApiFetch(`/v1/apps${qs}`, token, {}, fetchImpl)
  type AppRow = {
    id: string
    name?: string
    organization?: { slug?: string }
    'created_at'?: string
  }
  const data = (await res.json()) as
    | { apps?: AppRow[] }
    | AppRow[]
    | null
    | undefined

  const appsArr: AppRow[] = Array.isArray(data)
    ? (data as AppRow[])
    : ((data?.apps ?? []) as AppRow[])

  return appsArr.map((a) => ({
    id: a.id,
    name: a.name,
    organizationSlug: a.organization?.slug,
    createdAt: a.created_at,
  }))
}

export async function appExists(
  { token, appName, fetchImpl }: AppExistsBag,
): Promise<boolean> {
  // Use a direct fetch to distinguish 404 from other errors cleanly
  const fx = fetchImpl ?? fetch
  const url = `${API_BASE}/v1/apps/${encodeURIComponent(appName)}`
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  const res = await fx(url, { method: 'GET', headers })
  if (res.status === 404) return false
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Fly API error ${res.status}: ${res.statusText}\n${body}`)
  }
  return true
}

export type CreateMachineBagUnified = {
  appName: string
  token: string
  name: string
  config: Record<string, unknown>
  region?: string
  fetchImpl?: typeof fetch
}

export async function createMachine({
  appName,
  token,
  name,
  config,
  region,
  fetchImpl,
}: CreateMachineBagUnified): Promise<MachineSummary> {
  const body: Record<string, unknown> = { name, config }
  if (region) body.region = region
  const res = await flyApiFetch(
    `/v1/apps/${encodeURIComponent(appName)}/machines`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
    fetchImpl,
  )
  const m: RawMachine = await res.json()
  return mapRawMachineToSummary(m)
}
