# Router to agent-codex ttyd Workflow

This workflow tracks how an incoming browser request is shepherded by the Fly router until the browser is streaming a terminal session from the `agent-codex` ttyd server.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (Face Viewer)
  participant R as fly-router app
  participant CK as Clerk Auth
  participant FS as Computer Config (computers/{computer-id})
  participant E as fly-exec service
  participant M as agent-codex Machine (ttyd)

  B->>R: HTTPS request to agent subdomain
  alt No Clerk session
    R-->>B: Redirect to Clerk sign-in
    B->>CK: Complete authentication
    CK-->>B: Clerk session cookie
    B->>R: Retry request with auth
  end
  R->>FS: Read computer + agent record
  alt Machine missing
    R->>FS: Write instance entry (state=queued)
    R->>E: POST computer change notification
    E->>FS: Load queued instance state
    E->>M: Boot or resume agent-codex Fly Machine
    M-->>E: machine_id + ttyd listening
    E->>FS: Persist machine_id on instance
  else Machine already running
    FS-->>R: Return existing machine_id
  end
  R->>FS: Poll until machine_id available
  R->>E: fly replay targeting machine_id
  E->>M: Proxy HTTP/WS request to ttyd port
  M-->>E: ttyd PTY stream
  E-->>R: Stream frames back to router
  R-->>B: Stream forwarded to browser
  Note right of B: Browser iframe now speaks WebSocket to agent-codex ttyd
  Note over M: agent-codex launches ttyd via launchTmuxTerminal()
```

```mermaid
flowchart TD
  start([Browser loads agent subdomain])
  auth{Clerk session present?}
  signin[/Complete Clerk auth/]
  resolve["Router reads computer + agent config"]
  instance{Machine assigned?}
  queue["Router writes instance_state = queued"]
  notify["Router notifies fly-exec of change"]
  reconcile["fly-exec boots or resumes agent-codex machine"]
  persist["fly-exec stores machine_id on instance"]
  replay["Router polls until machine_id then issues fly replay"]
  proxy["fly-exec proxies HTTP/WS to agent-codex ttyd"]
  stream["ttyd streams PTY frames back"]
  deliver(["Browser iframe renders live ttyd session"])

  start --> auth
  auth -->|Session present| resolve
  auth -->|No session| signin
  signin --> resolve
  resolve --> instance
  instance -->|No| queue
  queue --> notify --> reconcile --> persist --> replay
  instance -->|Yes| replay
  replay --> proxy --> stream --> deliver
```
