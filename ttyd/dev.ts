import { launchTmuxTerminal } from './tmux.ts'

async function main() {
  const result = await launchTmuxTerminal({
    command: 'bash',
    args: ['-lc', 'echo "ttyd ready"; exec bash'],
    writeable: true,
  })
  console.log(`ttyd available at http://${result.ttydHost}:${result.ttydPort}`)
  result.sendInteraction('echo "hello"')
}

if (import.meta.main) {
  main()
}
