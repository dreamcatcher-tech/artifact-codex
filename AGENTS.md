The primary reference for the fly api is: https://fly.io/docs/machines/api/

The spec for the modelcontextprotocol is:
https://modelcontextprotocol.io/specification/2025-06-18

Repo for the npm package @modelcontextprotocol/sdk contains many examples and
can be found at: https://github.com/modelcontextprotocol/typescript-sdk

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
