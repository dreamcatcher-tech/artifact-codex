// make a zod schema that refers to what the agent.toml file looks like
import { parse, stringify } from '@std/toml'
import { z } from 'zod'

export const agentTomlSchema = z.object({
  /** The name of the agent */
  name: z.string(),
  /** The version of the agent */
  version: z.string(),
  /** The description of the agent */
  description: z.string().optional(),

  agent: z.object({
    /**
     * The executable to run to start the server.
     */
    command: z.string(),
    /**
     * Command line arguments to pass to the executable.
     */
    args: z.array(z.string()).optional(),
    /**
     * The environment to use when spawning the process.
     */
    env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    /**
     * The working directory to use when spawning the process.
     *
     * If not specified, the current working directory will be inherited.
     */
    cwd: z.string().optional(),
  }),
})

export type AgentToml = z.infer<typeof agentTomlSchema>
export type AgentParams = AgentToml['agent']

export function readAgentToml(tomlContent: string): AgentToml {
  const parsed = parse(tomlContent)
  return agentTomlSchema.parse(parsed)
}

export function toAgentToml(config: AgentToml): string {
  const normalized = agentTomlSchema.parse(config)
  return stringify(normalized)
}
