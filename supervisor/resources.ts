import Debug from 'debug'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  McpServer,
  RegisteredResource,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ListResourcesRequestSchema,
  type Resource,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js'

const log = Debug('@artifact/supervisor:resources')
const LIST_METHOD = ListResourcesRequestSchema.shape.method.value

type RawHandler = (
  request: unknown,
  extra: unknown,
) => Promise<unknown> | unknown

export const proxyResources = (client: Client) => {
  const states = new Map<McpServer, Map<string, RegisteredResource>>()
  const guarded = new WeakSet<McpServer>()
  let snapshot: Resource[] = []
  let syncing: Promise<void> | undefined

  const readThrough: RegisteredResource['readCallback'] = (uri) =>
    client.readResource({ uri: uri.toString() })

  const guardList = (server: McpServer) => {
    if (guarded.has(server)) return
    const handlers = (server.server as unknown as {
      _requestHandlers?: Map<string, RawHandler>
    })._requestHandlers
    const original = handlers?.get(LIST_METHOD)
    if (!handlers || typeof original !== 'function') return
    handlers.set(LIST_METHOD, async (request, extra) => {
      if (syncing) {
        try {
          await syncing
        } catch (error) {
          log('pending sync failed before listing resources: %o', error)
        }
      }
      return await original(request, extra)
    })
    guarded.add(server)
  }

  const syncServer = (
    server: McpServer,
    registrations: Map<string, RegisteredResource>,
  ) => {
    const seen = new Set<string>()
    for (const resource of snapshot) {
      const { uri, name, title, ...rest } = resource
      const metadata = {
        ...rest,
        ...(title === undefined ? {} : { title }),
      } as ResourceMetadata
      let registration = registrations.get(uri)
      if (registration) {
        const updates: Parameters<RegisteredResource['update']>[0] = {
          name,
          metadata,
          callback: readThrough,
          enabled: true,
        }
        if (title !== undefined) updates.title = title
        registration.update(updates)
      } else {
        registration = server.registerResource(name, uri, metadata, readThrough)
        registrations.set(uri, registration)
      }
      seen.add(uri)
    }
    for (const [uri, registration] of registrations) {
      if (seen.has(uri)) continue
      try {
        registration.remove()
      } finally {
        registrations.delete(uri)
      }
    }
  }

  const refresh = async () => {
    const { resources } = await client.listResources({})
    snapshot = resources
    for (const [server, registrations] of states) {
      syncServer(server, registrations)
    }
  }

  const ensureSync = () =>
    syncing ??= refresh().finally(() => {
      syncing = undefined
    })

  client.setNotificationHandler(
    ResourceListChangedNotificationSchema,
    ensureSync,
  )

  return async (server: McpServer) => {
    let registrations = states.get(server)
    if (!registrations) {
      registrations = new Map()
      states.set(server, registrations)
    }
    guardList(server)
    await ensureSync()
    syncServer(server, registrations)
    guardList(server)
  }
}
