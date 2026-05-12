# Security Model

## Sessions And CSRF

Supabase verifies identity. Open42 creates a server-side session row and sets:

- `open42_session`: HTTP-only session id.
- `open42_csrf`: readable CSRF token used on mutating requests.

The CSRF middleware checks origin, `Sec-Fetch-Site`, and token equality for
state-changing methods when a session cookie is present.

## Workspace Authorization

Tenant-scoped routes must use membership checks. The expected pattern is:

- `requireMembership({ from: 'param' })` for member-access routes.
- `requireRole([...], { from: 'param' })` for owner/admin routes.
- helpers in `auth/membership.ts` for repository-level checks.

Do not authorize from `users.current_workspace_id`; it is only a UI hint.

## Secret Storage

Open42 encrypts:

- gbrain OAuth client secrets.
- workspace BYOK provider keys.

The encryption key is `OPEN42_KEK`. Placeholder values are rejected at API boot.

## Provider Proxy

Tenant runtimes authenticate to Open42 with a tenant proxy token. The proxy:

- verifies a token hash stored on the workspace row.
- only forwards allowlisted OpenAI and Anthropic paths.
- resolves workspace BYOK keys first.
- only uses shared provider keys when `OPEN42_ALLOW_SHARED_KEYS` permits it.
- rate-limits failed proxy authentication attempts by IP.

## Logging

Error logging uses `sanitizeErrorForLog()` and Pino redaction paths. gbrain
request/response bodies and provider payloads should not be logged.

## Webhook Boundaries

Composio webhooks mount before JSON parsing so signature verification sees the
raw request body. Stripe webhooks are cloud-only and use a separate raw body
router plus event idempotency tracking.
