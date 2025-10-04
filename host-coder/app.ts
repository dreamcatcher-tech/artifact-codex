import Debug from 'debug'
import { createAgentWebServer } from '@artifact/supervisor'
import type {
  AgentWebServerOptions,
  IdleShutdownOptions,
} from '@artifact/supervisor'

import type { FaceKindConfig } from '@artifact/supervisor'
import { AGENT_KINDS, type AgentKindId } from '@artifact/shared'
import { startAgentTest } from '@artifact/agent-test'
import { startAgentInspector } from '@artifact/agent-inspector'
import { startAgentCodex } from '@artifact/agent-codex'
import { startAgentCmd } from '@artifact/agent-cmd'

const FACE_KIND_CREATORS: Record<AgentKindId, FaceKindConfig['create']> = {
  test: startAgentTest,
  inspector: startAgentInspector,
  codex: startAgentCodex,
  cmd: startAgentCmd,
}

export function resolveFaceKinds(): FaceKindConfig[] {
  const specs = AGENT_KINDS.filter((spec) => FACE_KIND_CREATORS[spec.id])
  return specs.map((spec) => {
    const creator = FACE_KIND_CREATORS[spec.id]
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      create: creator,
    }
  })
}

export interface CreateHostCoderAppOptions {
  idleShutdown?: {
    timeoutMs: number
    onIdle: () => void
  }
}

export interface HostCoderWebServerOptions extends AgentWebServerOptions {
  defaultFaceKindId: AgentKindId
  debugNamespace: string
  idleShutdown: IdleShutdownOptions
}

export function createHostCoderOptions(
  options: CreateHostCoderAppOptions = {},
): HostCoderWebServerOptions {
  const faceKinds = resolveFaceKinds()
  const debugNamespace = '@artifact/host-coder'
  const log = Debug(debugNamespace)
  const idleDefaults = options.idleShutdown ?? {
    timeoutMs: 5 * 60 * 1000,
    onIdle: () => {},
  }
  const idleShutdown: IdleShutdownOptions = {
    ...idleDefaults,
    log: log.extend('idle'),
  }

  return {
    serverName: 'host-coder',
    serverVersion: '0.0.1',
    faceKinds,
    log,
    timeoutMs: idleShutdown.timeoutMs,
    onIdle: idleShutdown.onIdle,
    defaultFaceKindId: 'codex',
    debugNamespace,
    idleShutdown,
  }
}

export function createApp(options?: CreateHostCoderAppOptions) {
  const serverOptions = createHostCoderOptions(options)
  return createAgentWebServer(serverOptions)
}
