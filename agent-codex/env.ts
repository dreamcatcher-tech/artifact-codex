import { envs } from '@artifact/shared'

/** The config strings that can be injected or default to the environment */
export type Env = {
  /** The URL of the OpenAI proxy that has the api keys in it */
  DC_OPENAI_PROXY_URL: string
  /** The local port for the agent mcp server */
  DC_PORT: number
  /** The local mcp auth token */
  DC_LOCAL_MCP_AUTH: string
}

export function getEnv(): Env {
  return {
    DC_OPENAI_PROXY_URL: envs.DC_OPENAI_PROXY_URL(),
    DC_PORT: envs.DC_PORT(),
    DC_LOCAL_MCP_AUTH: envs.DC_LOCAL_MCP_AUTH(),
  }
}
