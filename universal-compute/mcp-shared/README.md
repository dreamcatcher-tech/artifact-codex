@artifact/mcp-shared

Shared helpers and utilities used by the MCP servers in this repo.

- Fly Machines API helpers: `listMachines`, `createMachine`, `getFlyApp`,
  `listFlyApps`, `destroyFlyApp`, etc. See `fly.ts`.
- Naming helpers: `deriveBaseName`, `nextIndexForName`. See `naming.ts`.
- MCP utility helpers: `toStructured`, `toError`, `getEnv`, `isValidFlyName`.

## Tests

- Unit tests for Fly Machines helpers and naming live here:
  - `fly.test.ts`
  - `naming.test.ts`
- Run with `deno task ok` from this directory.

## Usage

- Import via the local package name: `@artifact/mcp-shared` (exported from
  `mod.ts`).
