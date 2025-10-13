import { Command } from '@cliffy/command'
import { dev } from '@artifact/agent-test'

if (import.meta.main) {
  await new Command()
    .name('supervisor')
    .description('A simple supervisor cli.')
    .version('v0.0.1')
    .option(
      '-p, --port <port:number>',
      'The port number for the local server.',
      { default: 8080 },
    )
    .action(async ({ port }) => {
      await dev(port)
    })
    .parse()
}
