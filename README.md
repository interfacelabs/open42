# Open42

Self-hostable Company Brain on top of [gbrain](https://github.com/garrytan/gbrain).

> Internal docs (PHILOSOPHY/DESIGN/ENGINEERING/CLAUDE) are gitignored. Read those before contributing.

## Stack

- **Frontend:** Next.js (Pages Router) + Tailwind CSS + shadcn/ui + Zustand
- **Backend:** Node + Express + TypeScript + Drizzle + Postgres + pgvector
- **gbrain integration:** `gbrain serve --http` per tenant on Fly/local Docker, backed by Postgres + pgvector
- **LLM:** Anthropic Claude with prompt caching
- **Tests:** Vitest + Playwright + custom LLM eval harness

## Repo layout

```
open42/
├── apps/
│   ├── landing/      Next.js Pages Router marketing site
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

`npm run dev:landing` runs the public landing app and reads `LANDING_PUBLIC_URL`
from the repo-root `.env.local`; the default port is 3002. `npm run dev:web`
runs the product app and reads `WEB_PUBLIC_URL` from the repo-root
`.env.local`. The product app should expose only `/sign_in` and `/sign_out` as
public pages; workspace screens live under `/auth/*`. `npm run dev:api` reads
`API_PORT`, or derives the port from `API_PUBLIC_URL` when `API_PORT` is not set.
If the API port changes, set both `API_PUBLIC_URL` and
`NEXT_PUBLIC_API_PUBLIC_URL`: server-side Next handlers use `API_PUBLIC_URL`,
while browser code can only see `NEXT_PUBLIC_*` variables. Docker Compose does
not read `.env.local` by default, so use `npm run db:up` or pass `--env-file
.env.local` manually.

Sign-in uses Supabase magic links. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be
real values for auth to send email. After Supabase verifies the link, Open42
creates the workspace brain:

- `TENANT_PROVISIONER=local-docker` builds `infra/Dockerfile.gbrain-tenant`, then
  starts one container per first-time user. That container runs Postgres +
  pgvector and gbrain together, backed by a Docker volume mounted at `/data`.
- `TENANT_PROVISIONER=fly` calls the Fly Machines API and creates one machine in
  `FLY_TENANTS_APP_NAME`. Each tenant Machine gets its own Fly volume mounted at
  `/data`; Postgres + pgvector run inside the same tenant Machine as gbrain.

The old debug-link path is intentionally not present; auth should fail loudly if
Supabase is not configured.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Run web + api in parallel |
| `npm run dev:landing` | Landing app only, using `LANDING_PUBLIC_URL` |
| `npm run docs:install` | Create `.venv-docs` and install MkDocs Material |
| `npm run docs:serve` | Serve the docs site locally |
| `npm run docs:build` | Build the docs site in strict mode |
| `npm run dev:web` | Web only, using `WEB_PUBLIC_URL` |
| `npm run dev:api` | API only, using `API_PORT` / `API_PUBLIC_URL` |
| `npm run db:up` | Start Postgres using `.env.local` |
| `npm run tenant:build` | Build the gbrain tenant image; defaults to `GBRAIN_TENANT_PLATFORM=linux/amd64` for Fly |
| `npm run tenant:create:fly -- --owner-user-id <id>` | Create one Fly tenant Machine from env |
| `npm run build` | Build landing, web, and api |
| `npm run typecheck` | TypeScript check landing, web, and api |
| `npm run lint` | Lint landing, web, and api |
| `npm run test` | Run Vitest suite |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:push` | Push schema directly to DB (dev only) |
| `npm run db:migrate` | Run pending migrations (prod) |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |

## License

TBD.
