# Tenant Provisioning

Tenant provisioning creates or attaches a gbrain runtime for a workspace and
persists the Open42-side connection metadata.

## Provisioning Flow

1. A workspace row is created in `provisioning` state.
2. A BullMQ provision job is enqueued.
3. `startProvisionWorker()` processes the job.
4. `provisionTenant()` selects the configured provisioner.
5. The provisioner creates or attaches a gbrain runtime.
6. Open42 waits for gbrain health.
7. Open42 registers an OAuth client with gbrain.
8. Open42 verifies the gbrain version matches `GBRAIN_VERSION`.
9. Open42 encrypts the OAuth client secret and stores runtime metadata.
10. The workspace is marked `ready`.

## Provisioners

| Provisioner | Mode | Description |
| --- | --- | --- |
| `local-docker` | Development | Starts one local Docker container per workspace. |
| `compose` | Community self-host | Points Open42 at the shared Compose `gbrain` service. |
| `fly` | Cloud | Creates Fly Machines and volumes through the cloud package. |

## Queue Behavior

Provisioning runs through BullMQ so retries and process restarts are recoverable.
The worker uses a small concurrency, resets workspace provisioning state on
manual retry, and writes a stable failure code only after retry exhaustion.

## Proxy Token Boundary

The tenant runtime receives a tenant proxy token as its provider key. Real
provider keys are resolved by the Open42 provider proxy at request time. This
keeps BYOK rotation independent of tenant runtime restarts.

## Version Pin

`GBRAIN_VERSION` defaults to `0.31.3`. Tenant provisioning calls gbrain health
and rejects runtimes that report a different version.
