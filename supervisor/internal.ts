import { createMcpHandler } from './mcp-handler.ts'
import Debug from 'debug'

const log = Debug('@artifact/supervisor:internal')

export const createInternal = () => {
  const internalMcpServer = createMcpHandler((server) => {
    log('registering internal mcp tools', server)
  })
  return internalMcpServer
}

export type Internal = ReturnType<typeof createInternal>
