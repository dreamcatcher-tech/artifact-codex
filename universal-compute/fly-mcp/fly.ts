export type ListMachinesBag = {
  appName: string
  token: string
  baseUrl?: string // test-only override; real tool uses default
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
}

type RawMachine = {
  id: string
  name?: string
  state?: string
  region?: string
  image?: string
  'image_ref'?: { repository?: string }
  'private_ip'?: string | null
  'created_at'?: string
}

export type CreateMachineBag = {
  appName: string
  token: string
  name: string
  image: string
  region?: string
  baseUrl?: string // test-only override; real tool uses default
  fetchImpl?: typeof fetch // allow mocking
}

export async function listFlyMachines({
  appName,
  token,
  baseUrl,
  fetchImpl,
}: ListMachinesBag): Promise<MachineSummary[]> {
  const base = (baseUrl ?? 'https://api.machines.dev').replace(/\/$/, '')
  const url = `${base}/v1/apps/${encodeURIComponent(appName)}/machines`

  const fx = fetchImpl ?? fetch
  const res = await fx(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Fly API error ${res.status}: ${res.statusText}\n${body}`)
  }

  const data = await res.json()
  const machines: RawMachine[] = Array.isArray(data)
    ? (data as RawMachine[])
    : ((data?.machines ?? []) as RawMachine[])
  return machines.map((m: RawMachine) => ({
    id: m.id,
    name: m.name,
    state: m.state,
    region: m.region,
    image: m.image ?? m.image_ref?.repository ?? undefined,
    ip: m.private_ip ?? undefined,
    createdAt: m.created_at ?? undefined,
  }))
}

export async function createFlyMachine({
  appName,
  token,
  name,
  image,
  region,
  baseUrl,
  fetchImpl,
}: CreateMachineBag): Promise<MachineSummary> {
  const base = (baseUrl ?? 'https://api.machines.dev').replace(/\/$/, '')
  const url = `${base}/v1/apps/${encodeURIComponent(appName)}/machines`

  const body: Record<string, unknown> = {
    name,
    config: { image },
  }
  if (region) body.region = region

  const fx = fetchImpl ?? fetch
  const res = await fx(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Fly API error ${res.status}: ${res.statusText}\n${text}`)
  }

  const m: RawMachine = await res.json()
  return {
    id: m.id,
    name: m.name,
    state: m.state,
    region: m.region,
    image: m.image ?? m.image_ref?.repository ?? image,
    ip: m.private_ip ?? undefined,
    createdAt: m.created_at ?? undefined,
  }
}
