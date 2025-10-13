type LaunchMode = 'tmux' | 'disabled'

function rawEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) ?? undefined
  } catch {
    return undefined
  }
}

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function optionalEnv(name: string): string | undefined {
  return normalize(rawEnv(name))
}

export const envs = {
  OPENAI_API_KEY: (): string => {
    const value = optionalEnv('OPENAI_API_KEY')
    if (!value) {
      console.warn('OPENAI_API_KEY is not set')
    }
    return value || ''
  },
  CODEX_AGENT_WORKSPACE: (): string | undefined =>
    optionalEnv('CODEX_AGENT_WORKSPACE'),
  CODEX_AGENT_HOME: (): string | undefined => optionalEnv('CODEX_AGENT_HOME'),
  CODEX_AGENT_LAUNCH: (): LaunchMode | undefined => {
    const value = optionalEnv('CODEX_AGENT_LAUNCH')
    if (value === 'tmux' || value === 'disabled') return value
    return undefined
  },
  CODEX_AGENT_NOTIFY_DIR: (): string | undefined =>
    optionalEnv('CODEX_AGENT_NOTIFY_DIR'),
}

export type { LaunchMode }
