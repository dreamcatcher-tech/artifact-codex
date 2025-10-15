function readAppEnv(name: string, fallback?: string): string {
  const value = Deno.env.get(name) ?? ''
  if (value.length === 0 && typeof fallback === 'string') {
    return fallback
  }
  if (value.length === 0) {
    throw new Error(`Missing ${name} in environment`)
  }
  return value
}

/** The config strings that can be injected or default to the environment */
export type Env = {
  /** The URL of the OpenAI proxy that has the api keys in it */
  DC_OPENAI_PROXY_URL: string
  /** The local port for the agent mcp server */
  DC_PORT: number
  /** The local mcp auth token */
  DC_LOCAL_MCP_AUTH: string
}

export const envs = {}
