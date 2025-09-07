@artifact/shared

Shared helpers and utilities used by the MCP servers in this repo.

- Fly Machines API helpers: `listMachines`, `createMachine`, `getFlyApp`,
  `listFlyApps`, `destroyFlyApp`, etc. See `fly.ts`.
- Token helpers: `probeTokenScope` to classify a `FLY_API_TOKEN` as org-scoped
  (org-wide) vs app-scoped (deploy token) by attempting an org apps listing
  (non-mutating). Provide `appName` (or ensure `FLY_APP_NAME` is set) so the org
  can be derived, or pass `orgSlug`.
- Naming helpers: `deriveBaseName`, `nextIndexForName`. See `naming.ts`.
- MCP utility helpers: `toStructured`, `toError`, `getEnv`, `isValidFlyName`.

## Tests

- Unit tests for Fly Machines helpers and naming live here:
  - `fly.test.ts`
  - `naming.test.ts`
  - `token-scope.test.ts`
- Run with `deno task ok` from this directory.

## Usage

- Import via the local package name: `@artifact/shared` (exported from
  `mod.ts`).
