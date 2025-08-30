**References**

- [FLY-MACHINES-RUN] Fly.io Docs — “fly machine run” (Machines). Describes `--file-literal`,
  `--file-local`, `--file-secret` and that values are written to files at creation. Accessed:
  2025-08-28. URL: https://fly.io/docs/machines/flyctl/fly-machine-run/

- [FLY-MACHINES-CREATE] Fly.io Docs — “fly machine create”. Lists
  `--file-literal`/`--file-local`/`--file-secret` on create. Accessed: 2025-08-28. URL:
  https://fly.io/docs/flyctl/machine-create/

- [FLY-APP-FILES] Fly.io Docs — “App configuration (fly.toml) → [[files]]”. Explains `files` entries
  and options (`raw_value`, `secret_name`, `local_path`). Accessed: 2025-08-28. URL:
  https://fly.io/docs/reference/configuration/#files

- [FLY-MACHINES-UPDATE] Fly.io Docs — “fly machine update”. Shows file flags are also accepted on
  update. Accessed: 2025-08-28. URL: https://fly.io/docs/flyctl/machine-update/

- [FLY-VOLUMES-OVERVIEW] Fly.io Docs — “Fly Volumes overview.” Notes that Fly Machine root file
  systems are ephemeral and that ephemeral disk performance is capped at 2000 IOPs and 8MiB/s,
  regardless of Machine type. Accessed: 2025-08-30. URL: https://fly.io/docs/volumes/overview/

- [FLY-ROOTFS-LIMITS] Fly.io Docs — “Troubleshoot your deployment → Image Size Limit.” States an
  8GB maximum rootfs size for non‑GPU Machines (50GB on GPU Machines) and explains the error when an
  image exceeds this limit. Accessed: 2025-08-30. URL:
  https://fly.io/docs/getting-started/troubleshooting/

- [MD-MERMAID-LINT] npm — “md-mermaid-lint: Validate Mermaid syntax within Markdown files.”
  Describes a CLI that scans `.md` files for fenced `mermaid` blocks and validates them using
  Mermaid’s parser. Accessed: 2025-08-29. URL: https://www.npmjs.com/package/md-mermaid-lint

- [MERMAID-CLI] GitHub — “mermaid-js/mermaid-cli.” Official CLI to render Mermaid diagrams and
  transform Markdown with diagrams; useful for stricter render checks. Accessed: 2025-08-29. URL:
  https://github.com/mermaid-js/mermaid-cli

- [MERMAID-USAGE-PARSE] Mermaid Docs — “Usage → Syntax validation without rendering
  (mermaid.parse).” Documents validating diagrams without rendering. Accessed: 2025-08-29. URL:
  https://mermaid.js.org/config/usage.html

- [MERMAID-PARSER-NPM] npm — “@mermaid-js/parser.” Official parser package exposing
  `parse(diagramType, text)` for syntax validation in Node without a browser. Accessed: 2025-08-29.
  URL: https://www.npmjs.com/package/@mermaid-js/parser

- [FLY-TOKENS] Fly.io Docs — “Access Tokens” (org tokens, deploy tokens, SSH, machine-exec). Accessed: 2025-08-30. URL: https://fly.io/docs/security/tokens/
- [FLY-MACHINES-API-AUTH] Fly.io Docs — “Machines API — Authentication and usage.” Accessed: 2025-08-30. URL: https://fly.io/docs/machines/api/working-with-machines-api/
- [FLY-BILLING-UNIFIED] Fly.io Docs — “Unified Billing (Billing Organizations and Linked Organizations).” Notes consolidation across up to 100 linked orgs; each org keeps its own private network; cross-org networking possible via Flycast. Accessed: 2025-08-30. URL: https://fly.io/docs/about/pricing/unified-billing/
- [FLY-FLYCAST] Fly.io Docs — “Flycast.” Private networking and cross-organization communication guidance. Accessed: 2025-08-30. URL: https://fly.io/docs/networking/flycast/

