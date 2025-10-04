import { withApp } from '@artifact/web-server/fixture'
import { expect } from '@std/expect'

// here we want to load up the supervisor fixture, and use it to boot up an agent

Deno.test({
  name: 'supervisor (pending harness)',
  ignore: true,
  fn: async () => {
    // @ts-expect-error temporary harness stub
    const { app: _app, fetch, client: _client } = await withApp({})
    const response = await fetch('/mcp')
    expect(response.status).toBe(200)
  },
})
