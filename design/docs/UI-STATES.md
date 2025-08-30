# UI States: ASCII Wireframes

Purpose: Define the terminal UI (TUI) for SSH sessions in clear, monospace-friendly diagrams. Each
state shows layout, labeled regions, and transitions. State names must exist in TERMS.md.

---

## Conventions

- Width: 80 columns. Use lightweight box chars `+ - |` when helpful.
- Placeholders: `{UPPER_SNAKE_CASE}` for dynamic values.
- Callouts: Annotate regions with `[n]` and list notes below the diagram.
- Transitions: `->` with condition/event.
- Accessibility: Do not depend on color to convey meaning.

---

## State Index

1. Welcome Banner
2. Agent Shell (Main)
3. Help Overlay
4. Tool Execution / Progress
5. Policy Blocked / Error
6. Face Summary / Exit
7. Face Switcher (Multi-Face)

---

## 1) Welcome Banner

```
+------------------------------------------------------------------------------+
| {PRODUCT_NAME} — {AGENT_DISPLAY_NAME}                                  [1]   |
|------------------------------------------------------------------------------|
| Welcome, {USER_NAME}.                                                         |
| Type `help` to see commands, or start interacting.                            |
|                                                                              |
| Face ID: {FACE_ID}               Started: {START_TIME}                         |
+------------------------------------------------------------------------------+
```

Notes

- [1] Header shows product + agent name. Keep under 72 chars.

Transitions

- -> Agent Shell on first prompt render.

---

## 2) Agent Shell (Main)

```
+------------------------------------------------------------------------------+
| {AGENT_DISPLAY_NAME} • {WORKSPACE_NAME}                                       |
|------------------------------------------------------------------------------|
| [Conversation]                                                                |
|  {TURN_INDEX}> {USER_INPUT}                                                   |
|  {AGENT_NAME}: {AGENT_REPLY_LINE_1}                                          |
|              {AGENT_REPLY_LINE_2}                                            |
|                                                                              |
| [Status] tokens:{TOKENS} cost:{COST} tools:{TOOL_COUNT} latency:{LATENCY_MS} |
|                                                                              |
| {PROMPT}                                                                      |
+------------------------------------------------------------------------------+
```

Notes

- `PROMPT` example: `{AGENT_SLUG}@{HOST}:{PWD}$`
- Keep status line compact; collapsible if needed.

Transitions

- `help` -> Help Overlay
- `exit`/`logout` -> Face Summary / Exit
- Tool request -> Tool Execution / Progress
- Policy violation -> Policy Blocked / Error
- `/faces` (alias: `/sessions`) or `Ctrl+Tab` -> Face Switcher (Multi-Face)

---

## 3) Help Overlay

```
+------------------------------------------------------------------------------+
| Help — Commands & Shortcuts                                                   |
|------------------------------------------------------------------------------|
| Commands:                                                                     |
|  help, exit, /tools, /log, /clear                                            |
| Shortcuts:                                                                    |
|  Ctrl+L clear, Ctrl+R search history                                          |
| Notes:                                                                        |
|  Use `/`-prefixed commands for agent controls.                                |
+------------------------------------------------------------------------------+
```

Transitions

- Any keypress `q` or `Esc` -> Agent Shell (Main)

---

## 4) Tool Execution / Progress

```
+------------------------------------------------------------------------------+
| Tool: {TOOL_NAME}                                                             |
|------------------------------------------------------------------------------|
| Args: {TOOL_ARGS}                                                             |
| Progress: [{PROGRESS_BAR}] {PCT}%  ETA:{ETA}s                                 |
| Output (tail):                                                                |
|  {OUTPUT_LINE}                                                                |
|                                                                              |
| [n] View full log with `/log`.                                                |
+------------------------------------------------------------------------------+
```

Transitions

- Success -> Agent Shell (Main) with summary line
- Failure -> Policy Blocked / Error or Agent Shell with error note

---

## 5) Policy Blocked / Error

```
+------------------------------------------------------------------------------+
| Action Blocked                                                                |
|------------------------------------------------------------------------------|
| Reason: {POLICY_REASON}                                                       |
| Detail: {DETAIL_MESSAGE}                                                      |
|                                                                              |
| Try: {SUGGESTED_ACTION}                                                       |
+------------------------------------------------------------------------------+
```

Transitions

- `Enter` -> Agent Shell (Main)

---

## 6) Face Summary / Exit

```
+------------------------------------------------------------------------------+
| Face Summary                                                                   |
|------------------------------------------------------------------------------|
| Duration: {DURATION}   Turns: {TURN_COUNT}   Tools: {TOOL_COUNT}              |
| Tokens: {TOKENS}   Estimated cost: {COST}                                     |
| Logs: {LOG_LOCATION}                                                          |
+------------------------------------------------------------------------------+
```

Transitions

- End SSH connection.

---

## 7) Face Switcher (Multi-Face)

```
+------------------------------------------------------------------------------+
| Faces — Switch or Create                                                     |
|------------------------------------------------------------------------------|
|  [*] {PAGE_ID} {PAGE_TITLE}                                                 |
|      {PAGE_ID} {PAGE_TITLE}                                                 |
|      {PAGE_ID} {PAGE_TITLE}                                                 |
|------------------------------------------------------------------------------|
|  n) New Page    c) Close    Enter) Switch    q) Back                        |
+------------------------------------------------------------------------------+
```

Notes

- Appears only when `concurrency.mode = "multi-face"`.
- Shows face/session list for the current agent path. All faces share the same filesystem/workspace.

Transitions

- `Enter` -> Agent Shell (Main) attached to selected face/session
- `n` -> Agent Shell (Main) with a new face/session focused
- `q`/`Esc` -> Agent Shell (Main)

---

## Change Control

- Any change to prompts, banners, or layouts must update this file and `USER-FLOW.md` together.
- State names and key terms must match `TERMS.md`.

