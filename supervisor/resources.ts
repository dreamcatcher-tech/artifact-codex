import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  VIEWS_RESOURCE_METADATA,
  VIEWS_RESOURCE_NAME,
  VIEWS_RESOURCE_URI,
} from '@artifact/shared'

export const proxyViewsResource = (client: Client) => {
  return (server: McpServer) => {
    server.registerResource(
      VIEWS_RESOURCE_NAME,
      VIEWS_RESOURCE_URI,
      VIEWS_RESOURCE_METADATA,
      async (uri) => {
        const contents = await client.readResource({ uri: uri.toString() })
        return contents
      },
    )
  }
}
