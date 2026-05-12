# Self-Hosting

Community self-hosting uses `docker-compose.community.yml`. It runs:

- API
- web app
- Open42 Postgres
- Redis
- one shared gbrain tenant runtime

## Quickstart

```bash
npm run setup
docker compose -f docker-compose.community.yml up --build
```

`npm run setup` writes generated secrets into `.env` and prompts for Supabase
values. The first Supabase magic-link recipient becomes the workspace owner.

## Required Values

| Variable | Purpose |
| --- | --- |
| `OPEN42_KEK` | Encrypts stored workspace credentials and gbrain OAuth secrets. |
| `SESSION_SECRET` | Session signing secret. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Supabase anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. |
| `OPEN42_SINGLE_WORKSPACE_ID` | Fixed workspace id for community mode. |
| `OPEN42_TENANT_PROXY_TOKEN` | Token used by the shared gbrain runtime to call the provider proxy. |

## BYOK Default

Community mode defaults to `OPEN42_ALLOW_SHARED_KEYS=false`. Add provider keys
inside Settings after signing in. Setting shared provider keys in the server
environment does not make them active unless shared keys are explicitly allowed.

## Compose Networking

Inside Compose, service hostnames such as `api`, `postgres`, `redis`, and
`gbrain` resolve through the Compose network. Outside Compose, use hostnames and
ports reachable from your local shell, such as `localhost`.

## Operations

Run database migrations through the API image entrypoint or:

```bash
npm run db:migrate
```

Back up the Open42 metadata Postgres volume and the gbrain volume. Redis should
be durable enough to recover queued jobs, but the source of truth for workspace
state is Postgres.
