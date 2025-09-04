import { expect } from '@std/expect'
import { deriveBaseName, nextIndexForName } from '@artifact/shared'

Deno.test('deriveBaseName strips trailing numeric suffix', () => {
  expect(deriveBaseName('agent')).toBe('agent')
  expect(deriveBaseName('agent-0')).toBe('agent')
  expect(deriveBaseName('agent-12')).toBe('agent')
  expect(deriveBaseName('foo-bar-003')).toBe('foo-bar')
  expect(deriveBaseName('name-abc')).toBe('name-abc')
})
Deno.test('nextIndexForName finds next integer', () => {
  const names = [
    'agent-0',
    'agent-1',
    'agent-2',
    'other-10',
    'agent-10',
    'agent-x',
    undefined,
  ]
  expect(nextIndexForName(names, 'agent')).toBe(11)
  expect(nextIndexForName(names, 'other')).toBe(11)
  expect(nextIndexForName(names, 'missing')).toBe(0)
})
