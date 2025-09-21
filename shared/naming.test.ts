import { expect } from '@std/expect'
import {
  agentToSubdomain,
  deriveBaseName,
  generateFlyMachineName,
  nextIndexForName,
  subdomainToAgent,
} from '@artifact/shared'

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

Deno.test('generateFlyMachineName approximates Fly machine names', () => {
  const name = generateFlyMachineName()
  const parts = name.split('-')
  expect(parts.length).toBe(3)
  expect(parts[0]).toMatch(/^[a-z]+$/)
  expect(parts[1]).toMatch(/^[a-z]+$/)
  expect(parts[2]).toMatch(/^\d{4}$/)
})

Deno.test('agentToSubdomain enforces DNS-safe path segments', () => {
  expect(agentToSubdomain(['foo'])).toBe('foo')
  expect(agentToSubdomain(['foo', 'bar'])).toBe('foo--bar')
  expect(() => agentToSubdomain([])).toThrow()
})

Deno.test('agentToSubdomain rejects invalid agent names', () => {
  expect(() => agentToSubdomain(['Foo'])).toThrow()
  expect(() => agentToSubdomain([' foo'])).toThrow()
  expect(() => agentToSubdomain(['foo '])).toThrow()
  expect(() => agentToSubdomain(['foo--bar'])).toThrow()
  expect(() => agentToSubdomain(['foo-'])).toThrow()
  expect(() => agentToSubdomain(['-foo'])).toThrow()
  expect(() => agentToSubdomain([''])).toThrow()
  expect(() => agentToSubdomain(['a'.repeat(64)])).toThrow()
  expect(() => agentToSubdomain(['a'.repeat(40), 'b'.repeat(24)])).toThrow()
})

Deno.test('subdomainToAgent splits and cleans subdomains', () => {
  expect(subdomainToAgent('foo--bar')).toEqual(['foo', 'bar'])
  expect(subdomainToAgent('FOO--BAR')).toEqual(['foo', 'bar'])
  expect(subdomainToAgent(' foo--bar ')).toEqual(['foo', 'bar'])
  expect(subdomainToAgent('--foo--bar--')).toEqual(['foo', 'bar'])
  expect(subdomainToAgent('')).toEqual([])
})
