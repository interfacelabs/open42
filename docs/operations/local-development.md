# Local Development

## Prerequisites

- Node.js 20 or newer.
- npm.
- Docker.
- A Postgres-compatible database for Open42 metadata.
- Redis for the provisioning queue.
- Supabase project values for magic-link auth.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:push
npm run dev
```

`npm run db:up` starts local Postgres and Redis using `docker-compose.yml`.
The default Postgres host port is `54338`; the default Redis host port is
`63799`.

## Development Servers

| Command | Purpose |
| --- | --- |
| `npm run dev` | Runs web and API together. |
| `npm run dev:web` | Runs the Next.js web app. |
| `npm run dev:api` | Runs the Express API with `tsx watch`. |
| `npm run dev:landing` | Runs the landing site. |

## Database Commands

| Command | Purpose |
| --- | --- |
| `npm run db:push` | Push current Drizzle schema for development. |
| `npm run db:generate` | Generate migrations from schema changes. |
| `npm run db:migrate` | Apply committed community migrations. |
| `npm run db:studio` | Open Drizzle Studio. |

## Tenant Runtime

For local development, `TENANT_PROVISIONER=local-docker` starts a local gbrain
container per workspace. For self-host Compose, `TENANT_PROVISIONER=compose`
uses the shared `gbrain` service.

Build the tenant image with:

```bash
npm run tenant:build
```
