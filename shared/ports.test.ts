import { expect } from '@std/expect'
import { HOST } from './consts.ts'
import {
  findAvailablePort,
  findAvailablePorts,
  waitForPort,
  waitForPorts,
} from './ports.ts'

Deno.test('findAvailablePort finds unused port and waitForPort detects listener', async () => {
  const port = await findAvailablePort({
    min: 40000,
    max: 40100,
    hostname: HOST,
  })
  const ac = new AbortController()
  const server = Deno.serve(
    { hostname: HOST, port, signal: ac.signal },
    () => new Response('ok'),
  )
  try {
    const ready = await waitForPort(port, { hostname: HOST, timeoutMs: 1000 })
    expect(ready).toBe(true)
  } finally {
    ac.abort()
    await server.finished
  }
})

Deno.test('waitForPort returns false before listener starts', async () => {
  const port = await findAvailablePort({
    min: 40110,
    max: 40130,
    hostname: HOST,
  })
  const ready = await waitForPort(port, { hostname: HOST, timeoutMs: 200 })
  expect(ready).toBe(false)
})

Deno.test('findAvailablePorts returns distinct ports within range', async () => {
  const ports = await findAvailablePorts(2, {
    min: 40140,
    max: 40180,
    hostname: HOST,
  })
  expect(ports.length).toBe(2)
  expect(ports[0]).not.toBe(ports[1])
  const success = await waitForPorts(ports, {
    hostname: HOST,
    timeoutMs: 100,
  })
  expect(success).toBe(false)
})
