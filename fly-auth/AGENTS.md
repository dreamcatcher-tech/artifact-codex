# fly-auth Infrastructure Testing

Use the `x-artifact-test-user` request header to impersonate the designated
integration Clerk user when hitting the deployed routes. This bypass is intended
only for automated integration tests targeting live Fly infrastructure.

## Testing purpose

There is a coordated replay sequence that happens between the auth app, the
actor app, and the agent machine. We need to test each leg of that sequence to
ensure its correctness. We must check prior stages before the latest test stages
can have any meaning. The apps are configured based this files

- auth app: `fly.auth.toml`
- actor app: `fly.computer.toml` NB: this is dynamically created for each actor
- agent app: `fly.base.toml` NB: there can be different agents used, but this
  version is lightweight for testing purposes

## Tracking interactions

Sometimes logs on the fly infrastructure can be delayed. Make sure that there is
a header you send in that is echoed in the machine logs that allows you to
identify the requests you are sending as part of this run. The responses you get
back at all times should also indicate the machine id, or any other identifying
information you find it helpful to track.

## Usage

- Issue an HTTPS request to the base url, which is usually
  `https://agentic.dreamcatcher.land/` (or your deployment domain).
- Set the header `x-artifact-test-user` to the value of
  `INTEGRATION_TEST_USER_ID` (hard coded to `integration-suite`). Requests with
  any other ID are rejected.
- The application skips the Clerk middleware result and provisions or replays
  the actor app exactly as if the authenticated user owned that ID.
- Configure a custom integration user by setting the `INTEGRATION_TEST_USER_ID`
  environment variable before deploying.

## Caveats

- Always send requests over TLS; the header grants full user provisioning
  access.
- The header bypass works only for the single integration user; other IDs are
  forced through Clerk.
- Set `INTEGRATION_TEST_USER_ID` consistently across all Fly apps that expect to
  access the integration actor so cleanup stays aligned.
- The header is honored regardless of environment; remove or disable the tests
  when running against production if you do not want this shortcut active.
- The shared NFS backend (`nfs-proto`) is configured with
  `auto_start_machines = true`, so you never need to manually wake it up before
  exercising these routes—the first request to the actor will spin it up for
  you.

## Deleting the Integration Actor

- The `DELETE /integration/actor` route tears down the integration actor by
  destroying the Fly app and removing the matching directory from the shared NFS
  mount.
- You must supply the same `x-artifact-test-user` header with the integration
  user value; otherwise the request is rejected with `401`.
- The cleanup removes Fly infrastructure
- Run delete before starting the test process, so you can be guaranteed to have
  the latest images, because part of the test is to exercise the creation of new
  fly apps correctly, which cannot be done if the app already exists.

## Replay Test

Validate the multi hop replay chain by following the redirects the platform
emits under the integration header:

### Step 1 - redirect to actor app

Send a request to the base URL and observe:

- the logs of the auth app mention a new actor machine being provisioned that
  matches the expected actor name, by using
  `fly logs --app <auth-app> --no-tail`
- the response is a redirect to `https://<actor-app>.agentic.dreamcatcher.land`
- verify using the fly cli that the actor app is provisioned ok:
  `fly status --app <actor-app> --json`

### Step 2 - redirect to agent machine

Send a request to the redirected address and observe:

- the logs of the auth app mention using fly replay to replay the request on the
  actor app
- the logs of the actor app mention the creation of a new agent, and the
  provisioning of a machine to run the agent on, mentioning the machine id, by
  using `fly logs --app <actor-app> --no-tail`
- the response is a redirect to
  `https://<agent-name>--<actor-app>.agentic.dreamcatcher.land`
- verify using the fly cli that the machine mentioned is operational
  `fly machine status <machine-id> --app <actor-app>`

### Step 3 - response from agent machine

Send a request to the redirected address
(`https://<agent-name>--<actor-app>.agentic.dreamcatcher.land`) and observe:

- the logs of the auth app mention using fly replay to replay the request on the
  actor app
- the logs of the actor app mention using fly replay to replay the request on
  the agent machine, and that it uses `fly_force_instance=<agent-machine-id>`
  header
- the logs of the agent machine mention receiving the request, by using
  `fly logs --app <actor-app> --machine <agent-machine-id> --no-tail`
- the response is what we expect from the agent machine

### Step 4 - repeat all of the above steps

Go thru each of the steps 1 - 3 above, and observe that:

- the agent name is different
- a different machine is being provided
- you can request to both agent names and both give an independnet response (ie:
  confirm both requests are being served by different machines)

## Example curl

```bash
curl -H 'x-artifact-test-user: integration-suite' https://agentic.dreamcatcher.land/
```

```bash
curl -X DELETE \
  -H 'x-artifact-test-user: integration-suite' \
  https://agentic.dreamcatcher.land/integration/actor
```
