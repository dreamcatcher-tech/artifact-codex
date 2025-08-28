## fly.io requirements

### auto start top

auto start and stop machines, if that is possible - may require artifact to
manage this directly

### machine smoke tests

https://fly.io/docs/reference/configuration/#services-machine_checks check if
codex can run well enough to decide to promote itself, possibly exercise itself,
and then if its well enough to deploy and solve a small puzzle, then we know
everything is well.

make some task that requires multiple agents that they have to solve, like get a
known broken repo working, and if they get that passing all the tests then we
know its good to deploy

### flycast to specific machine

need to be able to make a flycast request to a specific machine.

Request-based routing (chosen):

- fly-force-instance-id: strict pin to `<MACHINE_ID>`; no fallback. If the
  target is stopped/suspended, the request fails (no autostart).
- Auto-stop/suspend: continues to work independently. Requests pinned via
  `fly-force-instance-id` will not wake a stopped Machine; if on-demand wake +
  pinning is needed, use a running coordinator that replies with
  `Fly-Replay: instance=<MACHINE_ID>`.
- Use `<app>.flycast` and ensure the service/port is exposed in `fly.toml`.

## git provisioning

### reuse containers when repo is the same

seems best to use overlayFS so that we can make a single git repo view and have
many light weight images with deltas only. Some can be set readonly if we know
we don't need to write anything. Same agent can be restarted in a container with
rw or with more or less resources if needed. Avoids the full checkout time.

## virtualizing filesystems

what's the simplest network based filesystem that I can present to a docker
container that is running on the same network, with the goal being that the
provider of that network filesystem is virtualizing it, and only fulling in
files when the client actually asks for them.

what is the simplest and also what is the most performant if not the same ? I'm
interested in the most minimal implementation too, where the clients think
they're working in a folder that is a git repo, using the vanilla git tool

I'm open to anything - iscsi, nfs, whatever. even my own fuse if that is
easiest.

basically my central servers store git objects super efficient, and I need a way
to present these to client containers that virtualize the disk so the containers
stay small and very quick to checkout, and then they write, they hold the diffs
locally

## agent header mcp

What I need to do is to make the mcp server take a two tool commands:

1. start
2. message

when start is called, this container needs to run the 'codex' command, and it
needs to capture the stdout stream to a tmp file, and make it available for
download at any time on the url '/live'.

whenever the 'message' tool is called, it always contains a string, and it
immediately sends that string into stdin, as tho a user had entered it at a
terminal and then pressed enter.

## terminal

need to block some special keys, like ctrl+z so task isn't put into the
background.
