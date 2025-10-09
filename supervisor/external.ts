import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createMcpHandler } from './mcp-handler.ts'
import Debug from 'debug'
import { type IdleTrigger, toStructured } from '@artifact/shared'
import { INTERACTION_TOOLS } from '@artifact/shared'
import z from 'zod'
import { proxyViewsResource } from './resources.ts'

const log = Debug('@artifact/supervisor:supervisor')

export const createExternal = (client: Client, idler: IdleTrigger) => {
  const toolsPromise = client.listTools()
  const registerResources = proxyViewsResource(client)

  const externalMcpServer = createMcpHandler(async (server) => {
    const { tools } = await toolsPromise
    for (const [name, template] of Object.entries(INTERACTION_TOOLS)) {
      const clientTool = tools.find((tool) => tool.name === name)
      if (!clientTool) {
        throw new Error(`Tool ${name} not found`)
      }
      const title = clientTool.title ?? template.title
      const description = clientTool.description ?? template.description
      const tool = { ...template, title, description }
      const cb = callTool(client, name)
      server.registerTool(name, tool, cb)
    }
    server.registerTool('halt', {
      title: 'Halt',
      description: 'Halt the agent',
      inputSchema: {},
      outputSchema: {},
    }, () => {
      // TODO let the agent finish its current job
      idler.abort()
      return toStructured({})
    })
    registerResources(server)
  })
  return externalMcpServer
}

const callTool = (client: Client, name: string) => {
  const handler: ToolCallback<z.ZodRawShape> = async (params) => {
    log('calling tool %s with params %j', name, params)
    return await client.callTool({ name, arguments: params }) as CallToolResult
  }
  return handler
}

export type External = ReturnType<typeof createExternal>
