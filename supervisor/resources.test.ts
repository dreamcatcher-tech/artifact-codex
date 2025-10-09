import { expect } from '@std/expect'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { proxyViewsResource } from './resources.ts'
import {
  isTextContent,
  VIEWS_RESOURCE_METADATA,
  VIEWS_RESOURCE_NAME,
  VIEWS_RESOURCE_URI,
} from '@artifact/shared'

Deno.test('c1 -> s1 -----(proxy)---> c2 -> s2', async () => {
  const upstreamServer = new McpServer({ name: 'upstream', version: '0.0.0' })

  let viewsVersion = 1

  const viewsRegistration = upstreamServer.registerResource(
    VIEWS_RESOURCE_NAME,
    VIEWS_RESOURCE_URI,
    VIEWS_RESOURCE_METADATA,
    () => ({
      contents: [{
        uri: VIEWS_RESOURCE_URI,
        mimeType: VIEWS_RESOURCE_METADATA.mimeType,
        text: `views-${viewsVersion}`,
      }],
    }),
  )

  const [upClientTransport, upServerTransport] = InMemoryTransport
    .createLinkedPair()
  await upstreamServer.connect(upServerTransport)

  const upstreamClient = new Client({ name: 'proxy-client', version: '0.0.0' })
  await upstreamClient.connect(upClientTransport)

  const proxyServer = new McpServer({ name: 'proxy', version: '0.0.0' })
  const registerProxy = proxyViewsResource(upstreamClient)
  await registerProxy(proxyServer)

  const [testClientTransport, proxyServerTransport] = InMemoryTransport
    .createLinkedPair()
  await proxyServer.connect(proxyServerTransport)

  const proxyClient = new Client({ name: 'test-client', version: '0.0.0' })
  await proxyClient.connect(testClientTransport)

  // setup is now complete

  const list1 = await proxyClient.listResources({})
  expect(list1.resources).toHaveLength(1)
  expect(list1.resources[0].name).toBe('views')

  const read1 = await proxyClient.readResource({ uri: VIEWS_RESOURCE_URI })
  const content1 = read1.contents.find(isTextContent)
  expect(content1?.text).toBe('views-1')

  viewsVersion = 2
  viewsRegistration.update({
    metadata: {
      ...VIEWS_RESOURCE_METADATA,
      description: 'Views resource (updated)',
    },
    callback: () => ({
      contents: [{
        uri: VIEWS_RESOURCE_URI,
        mimeType: VIEWS_RESOURCE_METADATA.mimeType,
        text: `views-${viewsVersion}`,
      }],
    }),
  })

  const list2 = await proxyClient.listResources({})
  expect(list2.resources).toHaveLength(1)
  expect(list2.resources[0].name).toBe('views')

  const read2 = await proxyClient.readResource({ uri: VIEWS_RESOURCE_URI })
  const content2 = read2.contents.find(isTextContent)
  expect(content2?.text).toBe('views-2')
})
