**Lifecycle**

This document captures provisioning, config, updates, suspend/resume, and
teardown for the org-per-customer model.

**Provisioning (customer bootstrap)**

0. Prereq: Artifact app (central) already exists and holds `FLY_ORG_TOKEN`
   secret (org‑scoped token).

1. Create Customer App

```bash
ORG="<shared-org>"
REGION="<nearest>"
CUSTOMER_APP="<customer>-agents"
fly apps create -o "$ORG" "$CUSTOMER_APP"
```

2. Create Home Agent Machine in Customer App

```bash
fly machine run <image> -a "$CUSTOMER_APP" -r "$REGION" \
  --cmd "codex --config /etc/agent/config.toml" \
  --file-literal /etc/agent/config.toml="$(< ./config.toml)"
```

**Rotation**

- Rotate only the Artifact org token (`FLY_ORG_TOKEN`) on a schedule; customer
  apps hold no Fly API tokens.

**Teardown**

1. Revoke tokens:

```bash
fly tokens list   # locate names/ids
fly tokens revoke --name "infra@${ORG}"
fly tokens revoke --name "agents@${ORG}"
```

2. Destroy Machines and the Customer App.

**Notes**

- From inside the app’s private network, the Machines API is reachable via
  `_api.internal:4280`.
- Avoid using personal auth tokens in automation; keep the org‑scoped token only
  in Artifact. Customer apps should not store Fly API tokens.
