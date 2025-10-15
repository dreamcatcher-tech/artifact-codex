import { createAgentDev, createAgentFs } from '@artifact/shared'
import { getEnv } from './env.ts'

const env = getEnv()

const dev = createAgentDev(import.meta, {
  setup: createAgentFs,
  env,
})

if (import.meta.main) {
  await dev()
}
