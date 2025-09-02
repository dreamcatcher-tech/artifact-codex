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
  created_at?: string
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
  const machines = Array.isArray(data) ? data : data?.machines ?? []
  return machines.map((m: any) => ({
    id: m.id,
    name: m.name,
    state: m.state,
    region: m.region,
    image: m.image ?? m.image_ref?.repository ?? undefined,
    ip: m.private_ip ?? undefined,
    created_at: m.created_at ?? undefined,
  }))
}
