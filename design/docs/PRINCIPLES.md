**Design Principles (accepted — 2025-08-31)**

- **Always-Attached Face:** When the platform is responsive, the browser is always attached to a
  running terminal face. No spinners or detached “waiting” screens.
- **Progress via Face Chain:** Progress is shown by redirecting to the live face doing the work
  (concierge → provisioning → base machine face zero → interactive base face). Pre‑interactive faces
  are readonly.
- **Single Face per Page:** Exactly one `face_id` per browser page/tab. Handles/streams are scoped
  to that Page Session.
- **Terminal-First UX:** The terminal is the primary UI. Avoid duplicative overlays such as
  out‑of‑band log viewers.

See also: `USER-FLOW.md` (face‑chaining), `RUNTIME.md` (launch/face model), ADR 0012.
