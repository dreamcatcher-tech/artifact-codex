import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CallToolResult, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import { sendMessage, startCodex, isRunning } from './codex-runner.ts'

const capabilities: ServerCapabilities = {
  resources: { subscribe: false, listChanged: false },
  tools: { listChanged: false },
}

export type SimpleServerOptions = {
  name?: string
  version?: string
  title?: string
}

export const createMcpServer = async (
  opts: SimpleServerOptions = {},
): Promise<McpServer> => {
  const server = new McpServer({
    title: opts.title ?? 'Example MCP Server',
    name: opts.name ?? 'example-mcp-server',
    version: opts.version ?? '0.0.0',
  }, { capabilities })

  // A very small demonstration tool; we can extend later.
  server.registerTool(
    'echo',
    {
      description: 'Echo back a message',
      inputSchema: {
        message: z.string().describe('Message to echo back'),
      },
      outputSchema: {
        echoed: z.string(),
      },
    },
    async (args: { message: string }): Promise<CallToolResult> => {
      const structuredContent = { echoed: args.message }
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      }
    },
  )

  // Tool: start — launches `codex` and begins capturing stdout to tmp file
  server.registerTool(
    'start',
    {
      description:
        'Start the codex process and stream stdout to a live log file',
      inputSchema: {},
      outputSchema: {
        started: z.boolean(),
        alreadyRunning: z.boolean().optional(),
        logUrl: z.string(),
        running: z.boolean(),
      },
    },
    async (): Promise<CallToolResult> => {
      const { alreadyRunning } = await startCodex()
      const structuredContent = {
        started: !alreadyRunning,
        alreadyRunning,
        // Point to the terminal viewer instead of the raw log endpoint
        logUrl: '/view',
        running: isRunning(),
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      }
    },
  )

  // Tool: message — sends provided string to `codex` stdin immediately
  server.registerTool(
    'message',
    {
      description: 'Send a line of input to codex stdin',
      inputSchema: {
        text: z.string().describe('The exact text to send to stdin'),
      },
      outputSchema: {
        ok: z.boolean(),
      },
    },
    async (args: { text: string }): Promise<CallToolResult> => {
      await sendMessage(args.text)
      const structuredContent = { ok: true }
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      }
    },
  )

  return server
}
