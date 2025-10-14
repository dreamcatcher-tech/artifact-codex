type LaunchMode = 'tmux' | 'disabled'

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

export const envs = {
  OPENAI_API_KEY: (): string => {
    const value = readAppEnv('OPENAI_API_KEY', '')
    if (!value) {
      console.warn('OPENAI_API_KEY is not set')
    }
    return value
  },
  CODEX_AGENT_WORKSPACE: (): string => readAppEnv('CODEX_AGENT_WORKSPACE'),
  CODEX_AGENT_HOME: (): string => readAppEnv('CODEX_AGENT_HOME'),
  CODEX_AGENT_LAUNCH: (): LaunchMode | undefined => {
    const value = readAppEnv('CODEX_AGENT_LAUNCH')
    if (value === 'tmux' || value === 'disabled') return value
    return undefined
  },
  CODEX_AGENT_NOTIFY_DIR: (): string => readAppEnv('CODEX_AGENT_NOTIFY_DIR'),
}

export type { LaunchMode }
