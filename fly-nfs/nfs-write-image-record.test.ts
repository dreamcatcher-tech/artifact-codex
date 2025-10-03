import { expect } from '@std/expect'

import { readImageRecord, writeImageRecord } from './mod.ts'

Deno.test('exposes NFS image record helpers', () => {
  expect(typeof writeImageRecord).toBe('function')
  expect(typeof readImageRecord).toBe('function')
})
