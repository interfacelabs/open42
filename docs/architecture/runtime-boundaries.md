# Runtime Boundaries

Open42 has four important runtime boundaries.

## Browser To Web

`apps/web` is a Next.js Pages Router app. It renders product pages and exposes
thin `pages/api/**` handlers that proxy to the Express API. In local
development, `apps/web/next.config.js` also rewrites `/backend/:path*` to the
API server.

## Web To API

The Express API in `apps/api/src/index.ts` owns auth, CSRF, route mounting,
provider proxying, webhook handling, queues, and graceful shutdown. It reads
`.env.local` and `.env` at boot through `apps/api/src/env.ts`.

The API mounts:

- `/auth`
- `/healthz`
- `/proxy/openai`
- `/proxy/anthropic`
- `/webhooks/composio`
- `/workspaces/**`
- `/chat`

Cloud mode additionally mounts `/webhooks/stripe` and
`/workspaces/:id/billing`.

In cloud mode, `*.proxy.open42.ai` is routed to the API as an opt-in public
gbrain MCP proxy. Only gbrain MCP/OAuth endpoints are forwarded, and the
workspace owner/admin must enable the proxy before the host resolves to a
tenant runtime.

## API To gbrain

Open42 talks to gbrain through `GbrainClient` over HTTP:

- `/health` for readiness and version checks.
- `/mcp` JSON-RPC `tools/call` for pages, queries, chunks, jobs, versions, and stats.

The API records structural MCP audit metadata in `mcp_audit_log`. It does not
log gbrain request or response bodies.

When `OPEN42_GBRAIN_PROXY_DOMAIN` is configured, new tenant runtimes receive a
stable public issuer URL of the form
`https://ws-<workspace-id-hex>.<domain>`. Open42 still stores and uses the
private gbrain base URL for internal calls.

Public MCP access is additionally gated by Open42's MCP client registry:
owner/admin users create a named client through Open42, public `/token` only
forwards for active registered client ids, and public `/mcp` only forwards
bearer tokens that were issued through that registered path. Revoking a client
blocks future token issuance and existing tokens at the Open42 proxy.

## Tenant To Provider Proxy

Tenant gbrain runtimes do not receive real OpenAI or Anthropic keys. They get a
tenant proxy token as their provider key and call:

- `/proxy/openai/v1/embeddings`
- `/proxy/openai/v1/chat/completions`
- `/proxy/openai/v1/models`
- `/proxy/anthropic/v1/messages`
- `/proxy/anthropic/v1/messages/count_tokens`

The proxy verifies the tenant token, resolves the upstream key, forwards only
allowlisted routes, streams the upstream response, and records cloud usage when
cloud billing is enabled.

## Edition Boundary

`OPEN42_EDITION` controls edition behavior:

- `community`: cloud imports resolve to stubs for web builds; the API dynamic
  import returns `null`.
- `cloud`: the API imports `@open42/cloud/api`; the web alias points to
  `packages/cloud`; cloud migrations and dependencies are available.
