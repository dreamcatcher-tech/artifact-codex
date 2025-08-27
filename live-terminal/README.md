# Live Terminal (Deno + Vite + React)

A minimal web UI that renders a terminal using xterm.js and streams stdout from a remote process. Includes a mock stream for local development and an input box that logs commands.

## Prerequisites
- Deno 2.x

## Develop
- Start dev server: `deno task dev`
 
- Open http://localhost:5173

## Build & Preview
- Build: `deno task build`
- Preview built app: `deno task preview`

## Tests
- Run headless tests: `deno task test`
- UI mode: `deno task test:ui`
- If your environment restricts home writes, prefix with `DENO_DIR=.deno`.

## Lint & Format
- Lint: `deno task lint` (rules in `deno.json`)
- Format: `deno task fmt`

## Notes
- The terminal component lives in `src/features/terminal/TerminalPanel.tsx`.
- Mock streaming is on by default; to connect to a real stream, render `<TerminalPanel url="/api/stream" useMock={false} />` and return a streaming response from that endpoint.
