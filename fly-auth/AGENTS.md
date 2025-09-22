# fly-auth Infrastructure Testing

Use the `x-artifact-test-user` request header to impersonate the designated
integration Clerk user when hitting the deployed routes. This bypass is
intended only for automated integration tests targeting live Fly
infrastructure.

## Usage

- Issue an HTTPS request to `https://fly-auth.fly.dev/` (or your deployment
  domain).
- Set the header `x-artifact-test-user` to the value of
  `INTEGRATION_TEST_USER_ID` (defaults to `integration-suite`). Requests with
  any other ID are rejected.
- The application skips the Clerk middleware result and provisions or replays
  the actor app exactly as if the authenticated user owned that ID.
- Configure a custom integration user by setting the
  `INTEGRATION_TEST_USER_ID` environment variable before deploying.

## Caveats

- Always send requests over TLS; the header grants full user provisioning
  access.
- The header bypass works only for the single integration user; other IDs are
  forced through Clerk.
- Set `INTEGRATION_TEST_USER_ID` consistently across all Fly apps that expect
  to access the integration actor so cleanup stays aligned.
- The header is honored regardless of environment; remove or disable the tests
  when running against production if you do not want this shortcut active.
- The shared NFS backend (`nfs-proto`) is configured with
  `auto_start_machines = true`, so you never need to manually wake it up before
  exercising these routes—the first request to the actor will spin it up for
  you.

## Deleting the Integration Actor

- The `DELETE /integration/actor` route tears down the integration actor by
  destroying the Fly app and removing the matching directory from the shared
  NFS mount.
- You must supply the same `x-artifact-test-user` header with the integration
  user value; otherwise the request is rejected with `401`.
- Because the cleanup removes Fly infrastructure, run it only after verifying
  no tests are currently using the integration actor app.

## Fly API Tokens

- `fly tokens create` responses include a human-readable prefix, e.g.
  `FlyV1 fm2_lJPECA...`. The actual bearer token is the `fm2_...` segment.
- When setting `FLY_API_TOKEN` locally or via `fly secrets set`, either wrap
  the full value in quotes (`"FlyV1 fm2_..."`) so the space is preserved, or
  trim the leading `FlyV1 ` prefix and store only the `fm2_...` portion.
- Our provisioning code trims the prefix before saving the secret so the
  Machines API can authenticate without additional quoting.

## Example curl

```bash
curl -H 'x-artifact-test-user: integration-suite' https://fly-auth.fly.dev/
```

```bash
curl -X DELETE \
  -H 'x-artifact-test-user: integration-suite' \
  https://fly-auth.fly.dev/integration/actor
```
