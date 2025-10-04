import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { toError, toStructured } from '@artifact/shared'
import type {
  AgentDetail,
  AgentManager,
  AgentSummary,
  DestroyAgentArgs,
  DestroyAgentResult,
  ReadAgentResult,
} from './agent_manager.ts'

const machineSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  state: z.string().optional(),
  region: z.string().optional(),
  image: z.string().optional(),
  ip: z.string().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const machineDetailSchema = machineSummarySchema.extend({
  config: z.record(z.unknown()).optional(),
})

const listAgentsOutput = z.object({ machines: z.array(machineSummarySchema) })
const createAgentOutput = z.object({ machine: machineSummarySchema })
const readAgentOutput = z.object({
  exists: z.boolean(),
  agent: machineDetailSchema.optional(),
  reason: z.string().optional(),
})
const destroyAgentOutput = z.object({
  destroyed: z.boolean(),
  id: z.string(),
  name: z.string().optional(),
})

const createAgentInput = z.object({ name: z.string() })

const destroyAgentInput = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  force: z.boolean().optional(),
})

const readAgentInput = z.object({ id: z.string() })

const toResult = (value: Record<string, unknown>): CallToolResult =>
  toStructured(value)

export function createAgentsServer(
  server: McpServer,
  manager: AgentManager,
): McpServer {
  const toMachineSummary = (detail: AgentSummary) => ({
    id: detail.id,
    name: detail.name,
    state: detail.state,
    region: detail.metadata?.region as string | undefined,
    image: detail.image,
    ip: detail.metadata?.ip as string | undefined,
    createdAt: detail.createdAt,
    metadata: detail.metadata,
  })

  const toMachineDetail = (detail: AgentDetail) => ({
    ...toMachineSummary(detail),
    config: detail.config,
  })

  server.registerTool(
    'read_agent',
    {
      title: 'Read Agent',
      description:
        'Return structured info for an Agent (Machine) by agent id string, where id equals the Machine name. Looks up by name and returns full details, including metadata from config.',
      inputSchema: readAgentInput.shape,
      outputSchema: readAgentOutput.shape,
    },
    async (input, extra) => {
      console.log('read_agent', { input, extra })
      try {
        const parsed = readAgentInput.parse(input)
        const result: ReadAgentResult = await manager.readAgent(parsed.id)
        if (!result.exists) {
          return toResult({
            exists: false,
            reason: result.reason,
          })
        }
        return toResult({
          exists: true,
          agent: result.agent ? toMachineDetail(result.agent) : undefined,
        })
      } catch (error) {
        return toError(error)
      }
    },
  )

  server.registerTool(
    'list_agents',
    {
      title: 'List Agents',
      description: 'Lists Agents for the current Computer.',
      inputSchema: {},
      outputSchema: listAgentsOutput.shape,
    },
    async (_input, extra) => {
      console.log('list_agents', { extra })
      try {
        const machines: AgentSummary[] = await manager.listAgents()
        return toResult({
          machines: machines.map(toMachineSummary),
        })
      } catch (error) {
        return toError(error)
      }
    },
  )

  server.registerTool(
    'create_agent',
    {
      title: 'Create Agent',
      description:
        'Creates a new Agent for the current Computer using the image of the current Agent.  This is an expensive operation compared to creating a new face, so be sure that the request warrants a whole new agent, not just a new face on @self, remembering that @self is the current agent you are running on.',
      inputSchema: createAgentInput.shape,
      outputSchema: createAgentOutput.shape,
    },
    async (input, extra) => {
      console.log('create_agent', { input, extra })
      try {
        const parsed = createAgentInput.parse(input)
        const machine = await manager.createAgent(parsed.name)
        return toResult({
          machine: toMachineSummary(machine),
        })
      } catch (error) {
        return toError(error)
      }
    },
  )

  server.registerTool(
    'destroy_agent',
    {
      title: 'Destroy Agent',
      description:
        'Destroys a Machine (Agent) in the current Computer. Provide id or name.',
      inputSchema: destroyAgentInput.shape,
      outputSchema: destroyAgentOutput.shape,
    },
    async (input, extra) => {
      console.log('destroy_agent', { input, extra })
      try {
        const parsed = destroyAgentInput.parse(input) as DestroyAgentArgs
        const result: DestroyAgentResult = await manager.destroyAgent(parsed)
        return toResult({
          destroyed: result.destroyed,
          id: result.id,
          name: result.name,
        })
      } catch (error) {
        return toError(error)
      }
    },
  )

  return server
}
