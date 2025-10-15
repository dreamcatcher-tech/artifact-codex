import { createAgentDev } from '@artifact/shared'

export const dev = createAgentDev(import.meta)

if (import.meta.main) {
  await dev()
}
