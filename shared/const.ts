/**
 * Global host binding used anywhere we previously hardcoded
 * "127.0.0.1" or "localhost". Override via env `HOST`.
 */
export const HOST: string = (() => {
  try {
    return Deno.env.get('HOST') ?? '127.0.0.1'
  } catch {
    return '127.0.0.1'
  }
})()
export const MCP_PORT = 442

export const NFS_MOUNT_DIR = '/mnt/computers'
export const NFS_SHARE_PATH = '/data/computers'
export const COMPUTER_AGENT_CONTAINERS = 'org-agent-containers'

export const COMPUTER_AGENTS = 'agents'
export const COMPUTER_REPOS = 'repos'
export const COMPUTER_EXEC = 'exec'

export const AGENT_TOML = 'agent.toml'
export const AGENT_HOME = 'home'
export const AGENT_WORKSPACE = 'workspace'

export const REPO_CONTAINER_IMAGES = 'container-images'

export const SERVICE_VIEW_DEFAULT = {
  internal_port: 8080,
  protocol: 'tcp',
  ports: [{
    force_https: true,
    port: 80,
    handlers: ['http'],
  }, {
    port: 443,
    handlers: ['tls', 'http'],
  }],
}

export const SERVICE_VIEW_BROAD_PORTS = {
  internal_port: 8080,
  protocol: 'tcp',
  ports: [{
    start_port: 1024,
    end_port: 65535,
    handlers: ['tls', 'http'],
  }],
}

export const SERVICE_AGENT_CONTROL = {
  internal_port: 8080,
  protocol: 'tcp',
  ports: [{
    port: 442,
    handlers: ['tls', 'http'],
  }],
}
