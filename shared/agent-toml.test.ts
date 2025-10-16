import { expect } from '@std/expect'

import { AgentToml, readAgentToml, toAgentToml } from './agent-toml.ts'

Deno.test('readAgentToml parses the minimal agent configuration', () => {
  const minimalToml = `
name = "demo"
version = "0.0.1"

[agent]
command = "deno"
args = ["run", "main.ts"]
`

  const parsed = readAgentToml(minimalToml)

  expect(parsed).toEqual({
    name: 'demo',
    version: '0.0.1',
    agent: { command: 'deno', args: ['run', 'main.ts'] },
  })
})

Deno.test('toAgentToml produces a TOML string that round-trips via readAgentToml', () => {
  const config: AgentToml = {
    name: 'example-agent',
    version: '1.2.3',
    description: 'handles example workflows',
    agent: {
      command: 'deno',
      args: ['run', '--allow-all', 'main.ts'],
      env: {
        API_KEY: 'secret',
        RETRIES: 3,
        ENABLE_METRICS: true,
      },
      cwd: '/agents/example',
    },
  }

  const toml = toAgentToml(config)
  const parsed = readAgentToml(toml)

  expect(parsed).toEqual(config)
})
