#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
import Debug from 'debug'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { mount } from '@artifact/fly-nfs'
import {
  createAgentManager,
  resolveRuntimeComputerDir,
  resolveRuntimeComputerId,
  resolveRuntimeExecApp,
  resolveRuntimeImageRecord,
  shouldSkipExecKick,
  shouldSkipMount,
} from './agent_manager.ts'
import { createAgentsServer } from './server.ts'

async function bootstrap() {
  const log = Debug('@artifact/mcp-agents:main')
  if (shouldSkipMount()) {
    log('skipping NFS mount (MCP_AGENTS_SKIP_NFS=1)')
  } else {
    await mount(log, 'sync')
  }

  const computerId = resolveRuntimeComputerId()
  const computerDir = resolveRuntimeComputerDir()
  const imageRecordName = resolveRuntimeImageRecord()
  const execApp = shouldSkipExecKick() ? null : resolveRuntimeExecApp()

  const manager = createAgentManager({
    computerId,
    computerDir,
    imageRecordName,
    execApp,
  })

  const baseServer = new McpServer({ name: 'fly-mcp', version: '0.1.0' })
  const server = createAgentsServer(baseServer, manager)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (import.meta.main) {
  try {
    await bootstrap()
  } catch (error) {
    console.error('failed to start mcp-agents server:', error)
    Deno.exit(1)
  }
}
