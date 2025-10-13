import { Command } from '@cliffy/command'
import {
  callRemoteTool,
  INTERACTION_TOOLS,
  InteractionAwait,
  InteractionCancel,
  InteractionStart,
  InteractionStatus,
  MCP_PORT,
  readErrorText,
  requireStructured,
  type ToolResult,
} from '@artifact/shared'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const DEFAULT_AGENT_ID = '@self'
const DEFAULT_SUPERVISOR_HOST = 'localhost'
const DEFAULT_SUPERVISOR_PORT = 8080

type GlobalFlags = {
  agentId: string
  host: string
  port: number
}

function fail(message: string): never {
  console.error(message)
  Deno.exit(1)
}

async function executeTool(
  agentId: string,
  toolName: keyof typeof INTERACTION_TOOLS,
  args: Record<string, unknown>,
  host: string,
  port: number,
): Promise<CallToolResult> {
  const fetch = createForwardedFetch(MCP_PORT)
  return await callRemoteTool(agentId, toolName, args, {
    fetch,
    resolveAgentUrl: () => new URL(`http://${host}:${port}`),
  })
}

function ensureSuccess<T extends Record<string, unknown>>(
  result: CallToolResult,
): ToolResult<T> {
  if (result.isError) {
    const message = readErrorText(result)
    fail(message || 'Tool call failed without an error message.')
  }
  return result as ToolResult<T>
}

function createForwardedFetch(forwardedPort: number): FetchLike {
  const headerValue = String(forwardedPort)
  const baseFetch = globalThis.fetch
  const forwardedFetch: FetchLike = (input, init) => {
    const request = new Request(input, init as RequestInit)
    request.headers.set('Fly-Forwarded-Port', headerValue)
    return baseFetch(request)
  }
  return forwardedFetch
}

const common = <T extends Record<string, unknown>>(
  tool: keyof typeof INTERACTION_TOOLS,
  kind: 'id' | 'input',
) => {
  return async (options: GlobalFlags, ...rest: string[]) => {
    const { agentId, host, port } = options
    if (kind === 'input' && rest.length === 0) {
      fail('Interaction text is required.')
    }
    if (kind === 'id' && (!rest[0] || rest[0].length === 0)) {
      fail('Interaction id is required.')
    }
    const params = kind === 'id'
      ? { interactionId: rest[0] }
      : { input: rest.join(' ') }
    const result = await executeTool(
      agentId,
      tool,
      { ...params, agentId },
      host,
      port,
    )
    const success = ensureSuccess<T>(result)
    const structured = requireStructured(success)
    console.log(JSON.stringify(structured, null, 2))
  }
}

if (import.meta.main) {
  const root = new Command()
    .name('mcp')
    .description('Invoke MCP interaction tools on agents.')
    .version('v0.0.1')
    .globalOption(
      '--host <host:string>',
      `Supervisor host (defaults to ${DEFAULT_SUPERVISOR_HOST}).`,
      { default: DEFAULT_SUPERVISOR_HOST },
    )
    .globalOption(
      '--port <port:number>',
      `Supervisor port (defaults to ${DEFAULT_SUPERVISOR_PORT}).`,
      { default: DEFAULT_SUPERVISOR_PORT },
    )
    .globalOption(
      '-a, --agent-id <agentId:string>',
      'Target agent id (defaults to @self).',
      { default: DEFAULT_AGENT_ID },
    )
    .command(
      'start <input...:string>',
      INTERACTION_TOOLS.interaction_start.description,
    )
    .action(common<InteractionStart>('interaction_start', 'input'))
    .command(
      'await <interactionId:string>',
      INTERACTION_TOOLS.interaction_await.description,
    )
    .action(common<InteractionAwait>('interaction_await', 'id'))
    .command(
      'cancel <interactionId:string>',
      INTERACTION_TOOLS.interaction_cancel.description,
    )
    .action(common<InteractionCancel>('interaction_cancel', 'id'))
    .command(
      'status <interactionId:string>',
      INTERACTION_TOOLS.interaction_status.description,
    )
    .action(common<InteractionStatus>('interaction_status', 'id'))

  if (Deno.args.length === 0) {
    root.showHelp()
    Deno.exit(0)
  }

  await root.parse(Deno.args)
}
