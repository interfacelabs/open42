# Configuration

The community stack reads `.env` from the repo root. Use
`.env.community.example` as the shape reference.

## Required Variables

| Variable | Purpose |
| --- | --- |
| `OPEN42_EDITION=community` | Selects the self-hosted community edition. |
| `OPEN42_KEK` | Encrypts stored workspace credentials and gbrain OAuth secrets. |
| `SESSION_SECRET` | Session secret. |
| `OPEN42_SINGLE_WORKSPACE_ID` | Fixed workspace id for the self-host stack. |
| `OPEN42_TENANT_PROXY_TOKEN` | Token used by gbrain to call the Open42 provider proxy. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Supabase anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. |
| `DATABASE_URL` | Open42 metadata database URL. |
| `REDIS_URL` | Redis URL for queues. |
| `GBRAIN_BASE_URL` | gbrain service URL seen by the API. |

## Compose Defaults

Inside `docker-compose.community.yml`, service hostnames resolve on the Compose
network:

| Service | Hostname |
| --- | --- |
| API | `api` |
| Web | `web` |
| Postgres | `postgres` |
| Redis | `redis` |
| gbrain | `gbrain` |

If you run the API outside Compose, use hostnames and ports reachable from your
shell, such as `localhost`.

## Provider Keys

Community mode is BYOK-first:

- Add OpenAI or Anthropic keys in Settings after sign-in.
- Server environment provider keys are ignored unless shared keys are enabled.
- Anthropic is used for chat; OpenAI can be used for embeddings.

## Optional Connectors

Notion zip import works without a third-party connector account. Live Notion
OAuth through Composio requires:

| Variable | Purpose |
| --- | --- |
| `COMPOSIO_API_KEY` | Enables Composio-backed connectors. |
| `COMPOSIO_NOTION_AUTH_CONFIG_ID` | Notion auth configuration id. |
| `OPEN42_INGEST_HMAC_SECRET` | Signs connector OAuth and GitHub install state. |
| `COMPOSIO_WEBHOOK_SECRET` | Verifies Composio webhook requests. |

Set `OPEN42_DISABLE_COMPOSIO=true` to disable Composio even if a key is present.

GitHub repo sync uses a GitHub App and gbrain source sync. Cloud deployments use
the Open42-managed app. Community/self-host installs can leave `GITHUB_APP_*`
empty and create a workspace-owned app from the GitHub connection flow.

| Variable | Purpose |
| --- | --- |
| `OPEN42_INGEST_HMAC_SECRET` | Required for GitHub setup and install state. |
| `GITHUB_APP_ID` | Optional self-host override: deployment-owned GitHub App id. |
| `GITHUB_APP_SLUG` | Optional self-host override: GitHub App URL slug for install redirects. |
| `GITHUB_APP_PRIVATE_KEY` | Optional self-host override: GitHub App private key, with newlines escaped if stored in `.env`. |
| `GITHUB_WEBHOOK_SECRET` | Optional self-host override: verifies deployment-owned GitHub App webhook requests. |
| `GITHUB_GIT_PROXY_PUBLIC_URL` | Public HTTPS API base URL used by gbrain when cloning private repos. Defaults to `API_PUBLIC_URL`. |
