import Debug from 'debug'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  McpServer,
  RegisteredResource,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type Resource,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js'

const log = Debug('@artifact/supervisor:resources')

export const proxyResources = (client: Client) => {
  let currentResources: Resource[] = []

  return async (server: McpServer) => {
    // register the current known resources on the server
    // store the server in a set to be notified
    // remove the server when it closes
    // when the client closes, unregister all resources from all servers
  }
}
