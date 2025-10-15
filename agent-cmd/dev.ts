import { createAgentDev } from '@artifact/shared'

const dev = createAgentDev(import.meta)

if (import.meta.main) {
  await dev()
}
