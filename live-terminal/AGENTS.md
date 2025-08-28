# Repository Guidelines

## Project Structure & Module Organization

- **Source (`src/`)**: App entry `main.tsx`, root component `App.tsx`, styles
  `index.css`/`App.css`, assets in `src/assets/`.
- **Public (`public/`)**: Static files served at root (e.g., `/vite.svg`).
- **Config**: `deno.json` (tasks, fmt/lint), `vite.config.ts`, and HTML entry
  `index.html`.
- **Features**: Prefer `src/features/<name>/{components,hooks,types}`; keep
  modules small and well‑typed.

## Build, Test, and Development Commands (Deno)

- `deno task dev`: Start Vite dev server with HMR.
- `deno task build`: Build to `dist/` via Vite.
- `deno task preview`: Serve the built `dist/` locally.
- `deno task lint`: Run Deno linter.
- `deno task fmt`: Format with `deno fmt` (checked in CI).
- `deno task test`: Run unit tests via Vitest.

## Coding Style & Naming Conventions

- **TypeScript**: `strict` enabled; add explicit types at module boundaries.
- **Indentation**: 2 spaces; keep lines ≈100 chars.
- **React**: Components in `.tsx`, PascalCase (e.g., `TerminalView.tsx`); hooks
  `use*` in `hooks/`; shared types in `types.ts`.
- **Lint/Format**: Use `deno lint` (custom rules in `deno.json`) and `deno fmt`
  (80 cols, single quotes, no semicolons). Narrowly disable with
  `// deno-lint-ignore <rule>` where necessary.

## Testing Guidelines

- Framework: **Vitest** (+ React Testing Library). Name tests `*.test.ts(x)`
  near sources or in `src/__tests__/`.
- Commands: `deno task test` or `deno task test -- --ui`.

## Commit & Pull Request Guidelines

- **Commits**: Short, imperative subject (e.g., “add static page for terminal”);
  add body if rationale isn’t obvious.
- **PRs**: Describe scope and motivation, link issues (`Fixes #123`), include UI
  screenshots, ensure `deno task lint` and `deno task build` pass.

## Security & Configuration Tips

- **Env vars**: Only expose client vars with the `VITE_` prefix (e.g.,
  `VITE_API_BASE`). Never commit secrets.
- **Cache/ignores**: Exclude `dist/`, `node_modules/`, `.env*`, and Deno cache
  artifacts in VCS.
