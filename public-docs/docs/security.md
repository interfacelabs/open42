# Security

## Secrets

Never commit `.env`, real API keys, Supabase service role keys, generated
Open42 secrets, database dumps, or provider credentials.

`npm run setup` generates:

- `OPEN42_KEK`
- `SESSION_SECRET`
- `OPEN42_SINGLE_WORKSPACE_ID`
- `OPEN42_TENANT_PROXY_TOKEN`

Keep those values stable for an existing install. Rotating `OPEN42_KEK` without
re-encrypting stored data will make encrypted workspace credentials unreadable.

## Sessions

Open42 uses Supabase for identity verification and server-side sessions for app
auth. The browser receives an HTTP-only session cookie and a separate CSRF
cookie for mutating requests.

## Workspace Access

Workspace access is authorized through membership rows. Adding a user to a
workspace should happen through the product invite/member flows.

## Provider Keys

Workspace provider keys are encrypted before storage. gbrain receives a proxy
token instead of real provider keys; Open42 resolves the real key only when
proxying a provider request.

## Network Exposure

For internet-facing installs:

- Put TLS in front of the web app and API.
- Restrict direct access to Postgres, Redis, and gbrain.
- Set public URLs to their external HTTPS origins.
- Keep Supabase and provider credentials in a secret manager when possible.
