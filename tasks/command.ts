import { CommandExecutor, CommandResult, CommandRunOptions } from './types.ts'

const encoder = new TextEncoder()

export const defaultCommandExecutor: CommandExecutor = async (
  options: CommandRunOptions,
): Promise<CommandResult> => {
  const {
    command,
    args = [],
    env,
    stdin,
    stdout = 'piped',
    stderr = 'piped',
    check = false,
  } = options

  const commandOptions: Deno.CommandOptions = {
    args,
    env,
    stdin: stdin !== undefined ? 'piped' : 'inherit',
    stdout,
    stderr,
  }

  const child = new Deno.Command(command, commandOptions).spawn()

  if (stdin !== undefined && child.stdin) {
    const writer = child.stdin.getWriter()
    const payloads = Array.isArray(stdin) ? stdin : [stdin]
    try {
      for (const payload of payloads) {
        await writer.write(encoder.encode(payload))
        if (Array.isArray(stdin)) {
          await writer.write(encoder.encode('\n'))
        }
      }
    } finally {
      await writer.close().catch(() => {})
    }
  }

  const status = await child.status
  const result: CommandResult = {
    success: status.success,
    code: status.code,
    signal: status.signal ?? null,
    stdout: '',
    stderr: '',
  }

  if (stdout === 'piped' && child.stdout) {
    result.stdout = await new Response(child.stdout).text().catch(() => '')
  }
  if (stderr === 'piped' && child.stderr) {
    result.stderr = await new Response(child.stderr).text().catch(() => '')
  }

  if (check && !result.success) {
    throw new Error(`Command failed: ${command}`)
  }

  return result
}
