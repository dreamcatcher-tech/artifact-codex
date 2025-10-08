import {
  INTERACTION_TOOL_NAMES,
  type InteractionAwait,
  type InteractionCancel,
  type InteractionStart,
  type InteractionStatus,
  requireStructured,
  spawnStdioMcpServer,
  type ToolResult,
} from '@artifact/shared'
import { expect } from '@std/expect'
import { join } from '@std/path'
import { createCodexAgent } from './codex.ts'
import type { CodexAgent } from './codex.ts'
import type { CodexLaunchResult } from './config.ts'

const agentId = 'agent-codex'

Deno.test('destroy removes home directory when prepared', async () => {
  const workspace = await Deno.makeTempDir()
  let agent: CodexAgent | undefined
  try {
    agent = createCodexAgent({
      workspace,
      config: {
        env: { OPENAI_API_KEY: 'test-key' },
        launch: 'disabled',
      },
    })
    const status = await agent.status()
    const home = status.home
    if (!home) throw new Error('expected home directory')
    expect(await pathExists(home)).toBe(true)
    await agent.destroy()
    expect(await pathExists(home)).toBe(false)
  } finally {
    try {
      await agent?.destroy()
    } catch {
      // ignore
    }
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('interaction resolves after notification is written', async () => {
  const notifyDir = await Deno.makeTempDir()
  const agent = createCodexAgent({
    config: { notifyDir, launch: 'disabled' },
  })
  try {
    const interactionId = await agent.startInteraction('run tests')
    const payload =
      '{"type":"agent-turn-complete","turn-id":"t1","input-messages":["run tests"],"last-assistant-message":"done"}'
    await Deno.writeTextFile(join(notifyDir, 'notify.json'), payload)
    const value = await agent.awaitInteraction(interactionId)
    expect(value).toBe(payload)
    const status = await agent.status()
    expect(status.notifications).toBe(1)
    expect(status.lastNotificationRaw).toBe(payload)
  } finally {
    await agent.destroy()
    await Deno.remove(notifyDir, { recursive: true })
  }
})

Deno.test('cancelled interactions reject and status reports cancellation', async () => {
  const notifyDir = await Deno.makeTempDir()
  const agent = createCodexAgent({
    config: { notifyDir, launch: 'disabled' },
  })
  try {
    const interactionId = await agent.startInteraction('noop')
    const { cancelled, wasActive } = await agent.cancelInteraction(
      interactionId,
    )
    expect(cancelled).toBe(true)
    expect(wasActive).toBe(true)
    expect(agent.interactionStatus(interactionId)).toBe('cancelled')
    const awaited = await agent.awaitInteraction(interactionId).catch((err) =>
      err
    )
    expect(awaited).toBeInstanceOf(Error)
  } finally {
    await agent.destroy()
    await Deno.remove(notifyDir, { recursive: true })
  }
})

Deno.test('queues interactions and runs them in arrival order', async () => {
  const workspace = await Deno.makeTempDir()
  let agent: CodexAgent | undefined
  try {
    const sendCalls: string[] = []
    agent = createCodexAgent({
      workspace,
      config: {
        env: { OPENAI_API_KEY: 'test-key' },
        launch: 'tmux',
      },
      overrides: {
        sendKeys: (_session, input) => {
          sendCalls.push(input)
        },
        launchProcess: ({ host }): Promise<CodexLaunchResult> =>
          Promise.resolve({
            pid: 101,
            views: [{
              name: 'terminal',
              port: 1234,
              protocol: 'http',
              url: `http://${host}:1234`,
            }],
          }),
      },
    })
    const status = await agent.status()
    const home = status.home
    if (!home) throw new Error('expected home directory')

    const first = await agent.startInteraction('first command')
    const second = await agent.startInteraction('second command')
    expect(sendCalls).toEqual(['first command'])

    const payload1 =
      '{"type":"agent-turn-complete","turn-id":"one","input-messages":["first command"],"last-assistant-message":"done"}'
    await Deno.writeTextFile(join(home, 'notify.json'), payload1)
    await agent.awaitInteraction(first)
    await delay(10)
    expect(sendCalls).toEqual(['first command', 'second command'])

    const payload2 =
      '{"type":"agent-turn-complete","turn-id":"two","input-messages":["second command"],"last-assistant-message":"done"}'
    await Deno.writeTextFile(join(home, 'notify.json'), payload2)
    await agent.awaitInteraction(second)
  } finally {
    await agent?.destroy()
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('cancel interaction sends tmux interrupt when active', async () => {
  const workspace = await Deno.makeTempDir()
  let agent: CodexAgent | undefined
  try {
    const cancelSessions: string[] = []
    agent = createCodexAgent({
      workspace,
      config: {
        env: { OPENAI_API_KEY: 'test-key' },
        launch: 'tmux',
      },
      overrides: {
        sendKeys: () => {},
        sendCancel: (session) => {
          cancelSessions.push(session)
        },
        launchProcess: (
          { host, tmuxSession: _tmuxSession },
        ): Promise<CodexLaunchResult> =>
          Promise.resolve({
            pid: 202,
            views: [{
              name: 'terminal',
              port: 5678,
              protocol: 'http',
              url: `http://${host}:5678`,
            }],
            child: undefined,
          }),
      },
    })

    await agent.status()
    const interactionId = await agent.startInteraction('long running')
    const cancelResult = await agent.cancelInteraction(interactionId)
    expect(cancelResult.cancelled).toBe(true)
    expect(cancelResult.wasActive).toBe(true)
    expect(cancelSessions.length).toBe(1)

    const awaited = await agent.awaitInteraction(interactionId).catch((err) =>
      err
    )
    expect(awaited).toBeInstanceOf(Error)
  } finally {
    await agent?.destroy()
    await Deno.remove(workspace, { recursive: true })
  }
})

Deno.test('mcp server exposes interaction tools and resolves via notify', async () => {
  const notifyDir = await Deno.makeTempDir()
  try {
    await using srv = await spawnStdioMcpServer({
      env: {
        OPENAI_API_KEY: 'test-key',
        CODEX_AGENT_NOTIFY_DIR: notifyDir,
        CODEX_AGENT_LAUNCH: 'disabled',
      },
    })

    const listed = await srv.client.listTools({})
    const names = listed.tools.map((tool) => tool.name)
    for (const name of INTERACTION_TOOL_NAMES) {
      expect(names).toContain(name)
    }

    const started = await srv.client.callTool({
      name: 'interaction_start',
      arguments: { agentId, input: 'build project' },
    }) as ToolResult<InteractionStart>
    const { interactionId } = requireStructured(started)
    expect(typeof interactionId).toBe('string')

    const payload =
      '{"type":"agent-turn-complete","turn-id":"t42","input-messages":["build project"],"last-assistant-message":"done"}'
    await Deno.writeTextFile(join(notifyDir, 'notify.json'), payload)

    const awaited = await srv.client.callTool({
      name: 'interaction_await',
      arguments: { agentId, interactionId },
    }) as ToolResult<InteractionAwait>
    expect(requireStructured(awaited).value).toBe(payload)

    const status = await srv.client.callTool({
      name: 'interaction_status',
      arguments: { agentId, interactionId },
    }) as ToolResult<InteractionStatus>
    expect(requireStructured(status).state).toBe('completed')

    const cancelled = await srv.client.callTool({
      name: 'interaction_cancel',
      arguments: { agentId, interactionId },
    }) as ToolResult<InteractionCancel>
    expect(requireStructured(cancelled).cancelled).toBe(false)
  } finally {
    await Deno.remove(notifyDir, { recursive: true })
  }
})

async function pathExists(path: string) {
  try {
    await Deno.stat(path)
    return true
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false
    throw err
  }
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
