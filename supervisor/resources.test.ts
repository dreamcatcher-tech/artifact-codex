import { expect } from '@std/expect'
import { delay } from 'jsr:@std/async/delay'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { proxyResources } from './resources.ts'
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isTextContent } from '@artifact/shared'

Deno.test('c1 -> s1 -----(proxy)---> c2 -> s2', async () => {
  const upstreamServer = new McpServer({ name: 'upstream', version: '0.0.0' })

  let alphaVersion = 1
  let betaVersion = 1

  const alphaMeta: ResourceMetadata = {
    title: 'Alpha',
    description: 'Alpha resource',
    mimeType: 'text/plain',
  }

  const alphaRegistration = upstreamServer.registerResource(
    'alpha',
    'mcp://alpha',
    alphaMeta,
    () => ({
      contents: [{
        uri: 'mcp://alpha',
        mimeType: 'text/plain',
        text: `alpha-${alphaVersion}`,
      }],
    }),
  )

  const [upClientTransport, upServerTransport] = InMemoryTransport
    .createLinkedPair()
  await upstreamServer.connect(upServerTransport)

  const upstreamClient = new Client({ name: 'proxy-client', version: '0.0.0' })
  await upstreamClient.connect(upClientTransport)

  const proxyServer = new McpServer({ name: 'proxy', version: '0.0.0' })
  const registerProxy = proxyResources(upstreamClient)
  await registerProxy(proxyServer)

  const [testClientTransport, proxyServerTransport] = InMemoryTransport
    .createLinkedPair()
  await proxyServer.connect(proxyServerTransport)

  const proxyClient = new Client({ name: 'test-client', version: '0.0.0' })
  await proxyClient.connect(testClientTransport)

  // setup is now complete

  const list1 = await proxyClient.listResources({})
  expect(list1.resources).toHaveLength(1)
  expect(list1.resources[0].name).toBe('alpha')

  const read1 = await proxyClient.readResource({ uri: 'mcp://alpha' })
  const content1 = read1.contents.find(isTextContent)
  if (!content1) throw new Error('missing text content')
  expect(content1.text).toBe('alpha-1')

  alphaVersion = 2
  alphaRegistration.update({
    metadata: {
      ...alphaMeta,
      description: 'Alpha resource (updated)',
    },
    callback: () => ({
      contents: [{
        uri: 'mcp://alpha',
        mimeType: 'text/plain',
        text: `alpha-${alphaVersion}`,
      }],
    }),
  })

  const list2 = await proxyClient.listResources({})
  const alpha = list2.resources.find((resource) => resource.name === 'alpha')
  expect(alpha?.description).toBe('Alpha resource (updated)')

  const read2 = await proxyClient.readResource({ uri: 'mcp://alpha' })
  const content2 = read2.contents.find(isTextContent)
  expect(content2?.text).toBe('alpha-2')

  const betaRegistration = upstreamServer.registerResource(
    'beta',
    'mcp://beta',
    {
      title: 'Beta',
      description: 'Beta resource',
      mimeType: 'text/plain',
    },
    () => ({
      contents: [{
        uri: 'mcp://beta',
        mimeType: 'text/plain',
        text: `beta-${betaVersion}`,
      }],
    }),
  )

  const list3 = await proxyClient.listResources({})
  expect(list3.resources).toHaveLength(2)
  expect(list3.resources.map((resource) => resource.name))
    .toEqual(['alpha', 'beta'])

  betaVersion = 2
  betaRegistration.update({
    callback: () => ({
      contents: [{
        uri: 'mcp://beta',
        mimeType: 'text/plain',
        text: `beta-${betaVersion}`,
      }],
    }),
  })

  const read3 = await proxyClient.readResource({ uri: 'mcp://beta' })
  const content3 = read3.contents.find(isTextContent)
  expect(content3?.text).toBe('beta-2')

  alphaRegistration.remove()

  const list4 = await proxyClient.listResources({})
  expect(list4.resources).toHaveLength(1)
  expect(list4.resources[0].name).toBe('beta')

  // TODO check that closing the upstream client closes the proxy server
  await proxyClient.close()
  await proxyServer.close()
  await upstreamClient.close()
  await proxyServer.close()
  await upstreamServer.close()
})
