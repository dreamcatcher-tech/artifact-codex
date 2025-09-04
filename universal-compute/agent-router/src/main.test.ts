import app from './main.ts'

const fetch = (path: string, init?: RequestInit) =>
  app.request(new Request(`http://local${path}`, init))

Deno.test('health endpoints', async () => {
  const r1 = await fetch('/_healthz')
  const j1 = await r1.json()
  if (!j1.ok) throw new Error('health not ok')
})

Deno.test('base root guest redirects to home-agent', async () => {
  const r = await fetch('/', { headers: { host: 'dreamcatcher.ai' } })
  if (r.status !== 302) throw new Error('expected 302')
  if (!r.headers.get('Location')?.endsWith('/home-agent')) {
    throw new Error('expected redirect to home-agent')
  }
})

Deno.test('concierge issues face when missing', async () => {
  const r = await fetch('/concierge', { headers: { host: 'dreamcatcher.ai' } })
  if (r.status !== 302) throw new Error('expected 302')
  const loc = r.headers.get('Location')!
  if (!/face=/.test(loc)) throw new Error('face param missing')
})

Deno.test('app host adds face and renders', async () => {
  const r1 = await app.request(
    new Request('http://local/other-agent', { headers: { host: 'your-app.dreamcatcher.ai' } }),
  )
  if (r1.status !== 302) throw new Error('expected 302')
  const loc = r1.headers.get('Location')!
  if (!/face=/.test(loc)) throw new Error('face param missing')
  const r2 = await app.request(new Request(loc, { headers: { host: 'your-app.dreamcatcher.ai' } }))
  if (r2.status !== 200) throw new Error('expected 200')
  const html = await r2.text()
  if (!html.includes('Agent:') || !html.includes('Face:')) {
    throw new Error('page did not render agent view')
  }
})
