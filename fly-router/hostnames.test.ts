import { expect } from '@std/expect'
import {
  assertHostname,
  getAgentId,
  getComputerId,
  getSubdomain,
  isAgentDomain,
  isBaseDomain,
  isComputerDomain,
} from './hostnames.ts'

const BASE_DOMAIN = 'agentic.dreamcatcher.land'
const BASE_URL = `https://${BASE_DOMAIN}`
const COMPUTER_ID = 'computer-1'
const COMPUTER_URL = `https://${COMPUTER_ID}.${BASE_DOMAIN}`
const AGENT_ID = 'agent-1'
const AGENT_URL = `https://${AGENT_ID}--${COMPUTER_ID}.${BASE_DOMAIN}`

Deno.test('assertHostname allows the base domain and matching subdomains', () => {
  expect(() => assertHostname(BASE_DOMAIN, BASE_DOMAIN)).not.toThrow()
  expect(() => assertHostname(`${COMPUTER_ID}.${BASE_DOMAIN}`, BASE_DOMAIN))
    .not.toThrow()
})

Deno.test('assertHostname rejects hostnames that do not match the base domain', () => {
  expect(() => assertHostname('example.com', BASE_DOMAIN)).toThrow(
    'hostname mismatch: example.com !endsWith agentic.dreamcatcher.land',
  )
})

Deno.test('assertHostname rejects hostnames that only suffix-match within a label', () => {
  const attacker = `evil${BASE_DOMAIN}`
  expect(() => assertHostname(attacker, BASE_DOMAIN)).toThrow(
    `hostname mismatch: ${attacker} !endsWith agentic.dreamcatcher.land`,
  )
})

Deno.test('isBaseDomain recognises the bare base domain url', () => {
  expect(isBaseDomain(BASE_URL, BASE_DOMAIN)).toBe(true)
})

Deno.test('isBaseDomain returns false for non-base hostnames that share the suffix', () => {
  expect(isBaseDomain(COMPUTER_URL, BASE_DOMAIN)).toBe(false)
})

Deno.test('isBaseDomain throws when the hostname does not end with the base domain', () => {
  expect(() => isBaseDomain('https://example.com', BASE_DOMAIN)).toThrow(
    'hostname mismatch: example.com !endsWith agentic.dreamcatcher.land',
  )
})

Deno.test('getSubdomain extracts the single-segment subdomain for computer urls', () => {
  expect(getSubdomain(COMPUTER_URL, BASE_DOMAIN)).toBe(COMPUTER_ID)
})

Deno.test('getSubdomain extracts the combined agent and computer id for agent urls', () => {
  expect(getSubdomain(AGENT_URL, BASE_DOMAIN)).toBe(
    `${AGENT_ID}--${COMPUTER_ID}`,
  )
})

Deno.test('getSubdomain throws when no subdomain is present', () => {
  expect(() => getSubdomain(BASE_URL, BASE_DOMAIN)).toThrow(
    'subdomain is empty',
  )
})

Deno.test('getSubdomain rejects multi-level subdomains', () => {
  const multiLevel = `https://foo.bar.${BASE_DOMAIN}`
  expect(() => getSubdomain(multiLevel, BASE_DOMAIN)).toThrow(
    'subdomain contains a dot',
  )
})

Deno.test('getSubdomain rejects subdomains with more than one agent separator', () => {
  const invalid = `https://foo--bar--baz.${BASE_DOMAIN}`
  expect(() => getSubdomain(invalid, BASE_DOMAIN)).toThrow(
    'subdomain does not contain exactly one --',
  )
})

Deno.test('getComputerId returns the computer id for computer urls', () => {
  expect(getComputerId(COMPUTER_URL, BASE_DOMAIN)).toBe(COMPUTER_ID)
})

Deno.test('getComputerId returns the computer id for agent urls', () => {
  expect(getComputerId(AGENT_URL, BASE_DOMAIN)).toBe(COMPUTER_ID)
})

Deno.test('getAgentId returns the agent id for agent urls', () => {
  expect(getAgentId(AGENT_URL, BASE_DOMAIN)).toBe(AGENT_ID)
})

Deno.test('getAgentId rejects computer urls that lack agent information', () => {
  expect(() => getAgentId(COMPUTER_URL, BASE_DOMAIN)).toThrow(
    'subdomain does not contain agent id',
  )
})

Deno.test('isComputerDomain returns true only for computer urls', () => {
  expect(isComputerDomain(COMPUTER_URL, BASE_DOMAIN)).toBe(true)
  expect(isComputerDomain(AGENT_URL, BASE_DOMAIN)).toBe(false)
})

Deno.test('isComputerDomain propagates errors from invalid hostnames', () => {
  expect(() => isComputerDomain(BASE_URL, BASE_DOMAIN)).toThrow(
    'subdomain is empty',
  )
})

Deno.test('isAgentDomain returns true for agent urls and throws otherwise', () => {
  expect(isAgentDomain(AGENT_URL, BASE_DOMAIN)).toBe(true)
  expect(() => isAgentDomain(COMPUTER_URL, BASE_DOMAIN)).toThrow(
    'subdomain does not contain --',
  )
})
