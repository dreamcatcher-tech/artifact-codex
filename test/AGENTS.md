The purpose of this project is to test the sibling projects when they are all
running in unison.

the fundamental testing mode is to use Deno to spawn child processes that mimick
the `fly-router`, `fly-exec`, and each of the dockerfiles in the `hosts/`
folder, such as `hosts/basic.dockerfile` and `hosts/coder.dockerfile` and then
to make these mimicked instances aware of each other by setting env vars at
spawn.

An example of how to use Deno to do this is:

```ts
const teardown = new AbortController()
const command = new Deno.Command(Deno.execPath(), {
  args: ['run', '-A', 'main.ts'],
  clearEnv: true,
  env: { SOME_VAR: 'specific value' },
  cwd: '<repo_root>/supervisor/',
})
const child = command.spawn()
```

To avoid the mismatch between the fly.io deployed version and this local mock is
that the local mock cannot duplicate ports, so as long as the ports to listen on
are selected wisely, the mock will appear the same.

When the mock is setup, it needs to be told some basic info:

1. ROUTER_PORT - which port the `fly-router` app will listen on
2. EXEC_PORT - which port the `fly-exec` app will listen on
3. HOST_START_PORT - which port to make the first mock host on, and then
   incrementing up from there

Much of the mock ability hinges on injecting functions into the `fly-exec` app,
such as:

```ts
type ReconcilerOptions = {
  computerDir?: string
  startInstance?: (
    instance: HostInstance,
    computerId: string,
  ) => Promise<string>
  stopInstance?: (instance: HostInstance, computerId: string) => Promise<void>
  loadAgent?: (
    machineId: string,
    computerId: string,
    agentId: string,
  ) => Promise<void>
  listMachineIds?: () => Promise<Set<string>>
}
```

Each time the mock is run, a new tmp dir folder is created, which will act like
the shared filesystem that the `fly-nfs` project provides. This is cleaned up
when the mock is cleaned up.

This all allows us to:

1. set up a live mock that can be experiemented with where we can come at it
   from a browser or curl command and play with different responses.
2. have scripted tests that go thru different workflows and verify that all the
   projects work together in concert correctly

Nice to haves:

1. logging being written to disk or somehow readable so that each service can
   have its logs read easily to ease debugging
