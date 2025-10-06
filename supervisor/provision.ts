import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
import { z } from 'zod'
import { toStructured } from '@artifact/shared'

export const createProvisioner = () => {
  let provisioningPromise: Promise<void> | undefined
  return {
    isProvisioned: async () => {
      if (provisioningPromise) {
        return await provisioningPromise
      }
      return true
    },
    registerTools: (server: McpServer) => {
      server.registerTool('provision', {
        title: 'Provision',
        description: 'Provision the host as a specific agent',
        inputSchema: {
          computerId: z.string(),
          agentId: z.string(),
        },
        outputSchema: {
          ok: z.boolean(),
        },
      }, ({ computerId, agentId }) => {
        console.log('provision', computerId, agentId)
        if (!provisioningPromise) {
          provisioningPromise = new Promise(async (resolve, reject) => {
            try {
              await resolve()
            } catch (error) {
              reject(error)
            }
          })
        }
        return toStructured({
          ok: true,
        })
      })
    },
  }
}
