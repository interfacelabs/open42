# Source Map

This page records the code surfaces used to rebuild these docs.

## Runtime And Packages

| Area | Evidence |
| --- | --- |
| Root scripts and workspaces | `package.json` |
| API runtime | `apps/api/src/index.ts`, `apps/api/package.json` |
| Web runtime | `apps/web/next.config.js`, `apps/web/pages/**`, `apps/web/lib/api.ts` |
| Landing runtime | `apps/landing/package.json`, `apps/landing/src/**` |
| Mobile prototype | `apps/mobile/package.json`, `apps/mobile/**` |
| Cloud extension | `packages/cloud/**` |
| Community cloud stubs | `packages/cloud-stubs/**` |
| Docker images | `infra/Dockerfile.api`, `infra/Dockerfile.web`, `infra/Dockerfile.gbrain-tenant` |
| Compose files | `docker-compose.yml`, `docker-compose.community.yml` |
| CI | `.github/workflows/ci.yml` |

## API Modules

| Module | Purpose |
| --- | --- |
| `auth/` | Supabase identity, sessions, workspace membership, BYOK key resolution |
| `middleware/` | CSRF, membership, role gates, error sanitization |
| `routes/` | Auth, chat, workspaces, connections, ingest, library, skills, webhooks, provider proxy |
| `db/` | Drizzle schema and migrations |
| `tenants/` | Tenant runtime provisioning |
| `queue/` | BullMQ provision queue and worker |
| `gbrain/` | gbrain HTTP/MCP client and version checks |
| `connectors/` | Notion zip and Notion via Composio connectors |
| `ingest/` | Scheduler, workspace locks, staging, gbrain import orchestration |
| `skills/` | Skill draft schema, generation, validation, persistence |
| `proxy/` | Tenant proxy token generation and verification |

## Generated And Ignored Paths

The docs intentionally do not use generated outputs or local state as source
material: `.next/`, `dist/`, `coverage/`, `node_modules/`, `.env*`, `site/`,
and local planning/session folders are ignored.
