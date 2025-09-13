The primary reference for the fly api is: https://fly.io/docs/machines/api/

The spec for the modelcontextprotocol is:
https://modelcontextprotocol.io/specification/2025-06-18

Repo for the npm package @modelcontextprotocol/sdk contains many examples and
can be found at: https://github.com/modelcontextprotocol/typescript-sdk

The .refs folder contains code for reference only NEVER MODIFY ANYTHING INSIDE
THIS FOLDER

To verify the code works, run `deno task ok`.

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
