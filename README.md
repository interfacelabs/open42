# Open42

Self-hostable Company Brain on top of [gbrain](https://github.com/garrytan/gbrain).

> Internal docs (PHILOSOPHY/DESIGN/ENGINEERING/CLAUDE) are gitignored. Read those before contributing.

## Stack

- **Frontend:** Next.js (Pages Router) + Tailwind CSS + shadcn/ui + Zustand
- **Backend:** Node + Express + TypeScript + Drizzle + Postgres + pgvector
- **gbrain integration:** `gbrain serve --http` per tenant on Fly, MCP over private IPv6
- **LLM:** Anthropic Claude with prompt caching
- **Tests:** Vitest + Playwright + custom LLM eval harness

## Repo layout

```
open42/
├── apps/
│   ├── web/          Next.js Pages Router frontend
│   └── api/          Express + Drizzle backend
├── packages/         Shared TypeBox schemas, eval harness (TBD)
└── infra/            Docker, deploy configs (TBD)
```

## Local dev

```bash
# 1. Install Node 20
nvm use

# 2. Install deps
npm install

# 3. Copy env
cp .env.example .env.local
# edit .env.local: set DATABASE_URL, ANTHROPIC_API_KEY, OPEN42_KEK, etc.

# 4. Start Postgres via Docker Compose (pgvector image, non-default host port)
npm run db:up
# Default host port: 54338. To use a different port, set POSTGRES_HOST_PORT in .env.local
#   (also update DATABASE_URL to match).

# 5. Push the Drizzle schema to Postgres
npm run db:push

# 6. Start dev servers
npm run dev
```

`npm run dev:web` reads `WEB_PUBLIC_URL` from the repo-root `.env.local` and binds
Next to that port. `npm run dev:api` reads `API_PORT`, or derives the port from
`API_PUBLIC_URL` when `API_PORT` is not set. If the API port changes, set both
`API_PUBLIC_URL` and `NEXT_PUBLIC_API_PUBLIC_URL`: server-side Next handlers use
`API_PUBLIC_URL`, while browser code can only see `NEXT_PUBLIC_*` variables.
Docker Compose does not read `.env.local` by default, so use `npm run db:up` or
pass `--env-file .env.local` manually.

Signup uses Supabase magic links. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be
real values for auth to send email. After Supabase verifies the link, Open42
creates the workspace brain:

- `TENANT_PROVISIONER=local-docker` builds `infra/Dockerfile.gbrain-tenant` and
  starts one local gbrain container per first-time user.
- `TENANT_PROVISIONER=fly` calls the Fly Machines API and creates one machine in
  `FLY_TENANTS_APP_NAME`.

The old debug-link path is intentionally not present; auth should fail loudly if
Supabase is not configured.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Run web + api in parallel |
| `npm run dev:web` | Web only, using `WEB_PUBLIC_URL` |
| `npm run dev:api` | API only, using `API_PORT` / `API_PUBLIC_URL` |
| `npm run db:up` | Start Postgres using `.env.local` |
| `npm run tenant:build` | Build the local/Fly gbrain tenant image |
| `npm run build` | Build both apps |
| `npm run typecheck` | TypeScript check both apps |
| `npm run lint` | Lint both apps |
| `npm run test` | Run Vitest suite |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:push` | Push schema directly to DB (dev only) |
| `npm run db:migrate` | Run pending migrations (prod) |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |

## Manual Spike Scripts

These scripts are manual validation probes, not automatic CI or `npm test` steps:

- `./scripts/spike-gbrain-import-semantics.sh` checks gbrain `import` upsert behavior.
- `tsx scripts/spike-composio-tenant-isolation.ts` probes real Composio workspace isolation.
- `tsx scripts/spike-composio-ratelimit.ts` probes Composio rate-limit error shape.

## License

TBD.
