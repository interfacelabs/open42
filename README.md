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
docker compose up -d postgres
# Default host port: 54338. To use a different port, set POSTGRES_HOST_PORT in .env.local
#   (also update DATABASE_URL to match).

# 5. Push the Drizzle schema to Postgres
npm run db:push

# 6. Start dev servers (web on :3000, api on :3001)
npm run dev
```

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Run web + api in parallel |
| `npm run dev:web` | Web only (`http://localhost:3000`) |
| `npm run dev:api` | API only (`http://localhost:3001`) |
| `npm run build` | Build both apps |
| `npm run typecheck` | TypeScript check both apps |
| `npm run lint` | Lint both apps |
| `npm run test` | Run Vitest suite |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:push` | Push schema directly to DB (dev only) |
| `npm run db:migrate` | Run pending migrations (prod) |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |

## License

TBD.
