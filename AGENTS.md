The primary reference for the fly api is: https://fly.io/docs/machines/api/

The spec for the modelcontextprotocol is:
https://modelcontextprotocol.io/specification/2025-06-18

Repo for the npm package @modelcontextprotocol/sdk contains many examples and
can be found at: https://github.com/modelcontextprotocol/typescript-sdk

## .refs folder

The .refs folder contains code for reference only NEVER MODIFY ANYTHING INSIDE
THIS FOLDER. If you ever want to know about the inner workings of codex, then
you can read thru the code inside `.refs/codex/codex-rs/`.

## Deployment to fly.io

This project contains multiple fly apps, and the config files for them are all
in the root under fly.*.toml. To deploy these apps, use:

`fly deploy --config fly.<config name>.toml`

If you have done something that might affect how the fly apps work, be sure to
deploy or build using the fly.io infrastructure, until you are satisfied things
work correctly.

you can use the command `fly logs -c fly.<config name>.toml` to check the logs
of the app.

you can ssh in or send commands in using
`fly ssh console -c fly.<config name>.toml` which enables you to execute remote
commands.

## Fly deployment tips

- Keep the single `.dockerignore` at the repo root; Fly only reads the root
  file, so move any per-app rules there and make sure heavy directories like
  `node_modules/` stay excluded.
- If the builder is still uploading massive contexts, run `du -sh * | sort -h`
  to surface directories that should be ignored before redeploying.
- `fly deploy --config fly.<name>.toml` may run longer than two minutes when
  pushing larger layers—rerun without artificial timeouts and watch the Fly
  dashboard for status.

## Code rules

never git add anything unless explicitly told to.

Always value terseness and brevity over preserving legacy options in code - this
is a greenfields project so you never need to worry about legacy.

To verify the code works, run `deno task ok`.

To fix formatting errors quickly, run `deno fmt`.

To check types quickly, run `deno check`.

To fix lint errors quickly, run `deno lint --fix`

Whenever you change code, never leave comments saying what you changed - we
don't need that, we keep track of that in git commit messages, not in the code.

this pattern is perfectly acceptable, but note that you must use the //ignore
comment or some kind of comment to avoid lint issues:

```ts
try {
  a = riskyOperation()
} catch {
  // ignore
}
```

Whenever you see a task like `deno task dev` be very careful running it since it
is designed to never exit, as it runs a web server. If you must run this command
you will need to use a timeout or something to exit it.

when installing packages on deno, always use the deno install tool, like
`deno install jsr:@std/expect` or `deno install npm:debug`.

for tests, use expect from `jsr:@std/expect` which can be imported like this:
`import { expect } from '@std/expect'`

## Avoid Async IIFEs

Do not use anonymous Immediately Invoked Function Expressions (IIFEs), including
async versions like `;(async () => { ... })()` for side‑effects. Instead, define
a clearly named function and call it by name.

Bad:

```ts
;(async () => {
  // work
})()
```

Good:

```ts
async function sendKeysViaTmux(/* args */) {
  // work
}

await sendKeysViaTmux() /* args */
```

Benefits: clearer stack traces, easier testing and reuse, and no hidden
top‑level side effects.
