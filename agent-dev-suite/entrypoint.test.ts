import { expect } from '@std/expect'

import { parsePositiveInt } from './entrypoint.ts'

Deno.test('parsePositiveInt returns parsed value when positive integer string', () => {
  expect(parsePositiveInt('42', 5)).toBe(42)
})

Deno.test('parsePositiveInt falls back when value missing or invalid', () => {
  expect(parsePositiveInt(undefined, 7)).toBe(7)
  expect(parsePositiveInt('abc', 3)).toBe(3)
  expect(parsePositiveInt('-1', 2)).toBe(2)
})
