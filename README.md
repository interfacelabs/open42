# Open42

Self-hostable Company Brain on top of [gbrain](https://github.com/garrytan/gbrain). Open42 is the multi-tenant frontend, auth, billing, and connector framework. gbrain is treated as an immutable runtime dependency — Open42 sits on top, never patches.

> Internal docs (`PHILOSOPHY.md`, `DESIGN.md`, `ENGINEERING.md`, `CLAUDE.md`) are gitignored. Read them before contributing.

## Stack

| Layer | Choice |
|------|--------|
| Frontend | Next.js (Pages Router) + Tailwind + shadcn/ui + Zustand |
| Backend | Node + Express + TypeScript + Drizzle |
| Database | Postgres + pgvector (one Open42 metadata DB; one gbrain DB per tenant) |
| LLM | Anthropic Claude (chat) + OpenAI (embeddings), via per-tenant egress proxy |
| Auth | Supabase magic-link + per-tenant OAuth DCR for gbrain |
| Tenant runtime | gbrain in a Docker container per workspace (local) or Fly Machine (cloud) |
| Tests | Vitest + Playwright |

## Repo layout

```
open42/
├── apps/
│   ├── landing/      Next.js marketing site (port 3002)
│   ├── web/          Next.js product app (port 3000)
│   │   ├── pages/    Routed pages and API handlers
│   │   ├── lib/      Server-side helpers (NEVER inside pages/)
│   │   └── __tests__/ Vitest mirror of pages/ (kept out of pages/ to avoid Next routing)
│   └── api/          Express backend (port 3001)
├── infra/            Dockerfile.gbrain-tenant, docker-compose
└── scripts/          Manual probes + dev helpers
```

## Quick start

```bash
nvm use                          # Node 20+
npm install
cp .env.example .env.local       # then fill in the required values below
npm run db:up                    # start Postgres (pgvector) on host port 54338
npm run db:push                  # apply Drizzle schema
npm run dev                      # web (3000) + api (3001) in parallel
```

Sign in at http://localhost:3000/sign_in — you'll get a Supabase magic link. The first sign-in provisions a per-user gbrain tenant container.

## Required environment variables

Anything marked **required** must be set or the app will fail loudly.

### Boot — required
| Var | What | Notes |
|-----|------|-------|
| `DATABASE_URL` | Open42 metadata DB | `postgres://open42:open42@localhost:54338/open42` for the bundled compose |
| `OPEN42_KEK` | 32-byte master key | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_PORT` / `API_PUBLIC_URL` / `NEXT_PUBLIC_API_PUBLIC_URL` | API host wiring | Server code reads `API_PUBLIC_URL`; browser code can only see `NEXT_PUBLIC_*` |
| `WEB_PUBLIC_URL` / `NEXT_PUBLIC_OPEN42_APP_URL` | Web host wiring | Used for CORS origin allowlist + invite link rendering |
| `GBRAIN_VERSION` | Pin gbrain (currently `0.31.3`) | Bumping is a deliberate Open42 release event |
| `GBRAIN_GIT_REF` | Immutable SHA on `garrytan/gbrain` | Default pin matches `GBRAIN_VERSION`; production MUST build from a SHA |

### Auth — required for sign-in
| Var | What |
|-----|------|
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | Public anon key from Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — needed to send invites |

In production, sign-in is closed by default. Open it deliberately with one of:

| Var | What |
|-----|------|
| `OPEN42_ALLOWED_EMAILS` | Comma-separated allowlist |
| `OPEN42_ALLOWED_EMAIL_DOMAINS` | Comma-separated domain allowlist |
| `OPEN42_ENABLE_OPEN_SIGNUPS=true` | Public signups (use only for intentionally public deploys) |

### LLM — required for chat
| Var | What | Notes |
|-----|------|-------|
| `ANTHROPIC_API_KEY` | Shared chat key (fallback) | Workspace owners can override per-tenant via Settings → API Keys (BYOK) |
| `OPENAI_API_KEY` | Shared embeddings key (fallback) | Same BYOK override path |
| `ANTHROPIC_MODEL` | Optional model override | Defaults to `claude-3-5-sonnet-latest` |

Real provider keys never enter the tenant container. Each tenant's gbrain talks to `OPEN42_API/proxy/openai` and `/proxy/anthropic` using a per-tenant proxy token; the proxy resolves the upstream key (BYOK row → shared env fallback) at request time.

### Connectors — required for Notion / Composio
| Var | What |
|-----|------|
| `COMPOSIO_API_KEY` | Composio API key |
| `COMPOSIO_NOTION_AUTH_CONFIG_ID` | Composio Notion auth config id |
| `OPEN42_INGEST_HMAC_SECRET` | HMAC secret for OAuth state signing |
| `COMPOSIO_WEBHOOK_SECRET` | Webhook signing secret from the Composio dashboard. Without this, `/webhooks/composio` returns 503 instead of 5xx-retry-storming |
| `COMPOSIO_BASE_URL` | Optional; only set for self-hosted Composio |

### Tenant provisioning
Pick one provisioner via `TENANT_PROVISIONER`:

**`local-docker` (default for dev)** — builds `infra/Dockerfile.gbrain-tenant` and starts one container per first-time user.
| Var | What |
|-----|------|
| `GBRAIN_TENANT_IMAGE` | e.g. `open42/gbrain-tenant:v0.31.3` |
| `GBRAIN_TENANT_PLATFORM` | `linux/amd64` for parity with Fly |
| `GBRAIN_LOCAL_PORT_START` | First port to allocate (default 18080) |
| `GBRAIN_POSTGRES_USER` / `GBRAIN_POSTGRES_DB` / `GBRAIN_POSTGRES_PASSWORD` | Optional tenant Postgres creds |

**`fly`** — calls the Fly Machines API.
| Var | What |
|-----|------|
| `FLY_API_TOKEN` | Fly token |
| `FLY_TENANTS_APP_NAME` | App name that hosts tenant Machines |
| `GBRAIN_TENANT_REGION` | Optional preferred region |
| `GBRAIN_TENANT_VOLUME_SIZE_GB` | Default 3 |
| `OPEN42_API_FLYCAST_HOST` | Open42 API host reachable from tenant Machines (used as `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` inside the tenant) |

### Email (invites)
| Var | What |
|-----|------|
| `RESEND_API_KEY` | Resend API key (required in production) |
| `RESEND_FROM_ADDRESS` | Optional; defaults to `open42 <noreply@open42.app>` |
| `OPEN42_EMAIL_STDOUT_FALLBACK=true` | Dev-only; prints invite emails to stdout when `RESEND_API_KEY` is unset |

### Sessions / budget / ops (optional, sensible defaults)
| Var | Default | What |
|-----|---------|------|
| `SESSION_COOKIE_NAME` | `open42_session` | |
| `SESSION_TTL_DAYS` | `30` | |
| `MAGIC_LINK_TTL_MINUTES` | `15` | |
| `OPEN42_CHAT_RATE_LIMIT_PER_MINUTE` | `20` | Per-workspace request cap |
| `OPEN42_CHAT_INPUT_CHARS_PER_MINUTE` | `40000` | Per-workspace input-char cap |
| `LOG_LEVEL` | `info` | Pino level |
| `POSTGRES_HOST_PORT` | `54338` | Compose-mapped host port — keep in sync with `DATABASE_URL` |

### E2E tests
| Var | What |
|-----|------|
| `E2E_BASE_URL` | Web app base for Playwright (defaults to `http://localhost:3000`) |
| `E2E_API_BASE_URL` | API base for Playwright |
| `E2E_VISUAL=1` | Run visual regression specs |
| `E2E_FULL=1` | Run full onboarding/invite specs |

## Verify your setup

After `npm install` and editing `.env.local`:

```bash
npm run typecheck                # all three workspaces compile
npm run test                     # API: 205 / Web: 41 (DB-gated tests skip without DATABASE_URL)
npm run db:up && npm run db:push # Postgres up + schema applied
npm run dev                      # web on 3000, api on 3001
```

Then in a browser:

1. **Sign in.** Go to http://localhost:3000/sign_in, enter your email, click the magic link from Supabase. You should land on `/auth/onboard`.
2. **Workspace provisioning.** Submit a workspace name. Watch the API logs — you should see `provision` events and a tenant Docker container start (`docker ps | grep open42-gbrain`). The page polls `/workspaces/current` and switches to `/auth/home` once gbrain is ready (~30 s).
3. **Chat.** Ask a question. With no docs ingested you should see "I don't have anything about this in your brain." With a connection synced you should see streamed tokens with `[1]` citations.
4. **BYOK.** Settings → API Keys: add a personal Anthropic key, save. The form clears after save (the secret never lingers in the DOM). Chat now uses your key — confirm in API logs by `keySource: 'tenant'`.
5. **Connections / ingest.** Connect Notion via Composio (requires `COMPOSIO_*` env), then trigger sync from the workspace home. Verify pages land in gbrain.

## What to test for the recent fixes

Three fixes shipped on `main` after the codex crash. Each has a specific manual check.

### F1 · `proxy-security` and tests moved out of `pages/`
The Pages Router was treating `pages/api/_lib/proxy-security.ts` and six `*.test.tsx` siblings as routes. Both moves are mechanical (paths only, no logic).

What to verify:
- `npm run typecheck` exits 0 (was failing with TS2344 on `.next/types/validator.ts`).
- `npm test -w @open42/web` is 41/41 green.
- `curl -i http://localhost:3000/api/_lib/proxy-security` returns **404** (was reachable before).
- `curl -i http://localhost:3000/sign_in.test` returns **404**.
- Sign-in still works end-to-end (touches 18 of the moved import paths). The full onboarding flow above is the canary.

### F2 · IP first-octet binding removed from `validateSession`
Sessions are now validated by user-agent + cookie + expiry, not by IP `/8`.

What to verify:
- Sign in on home Wi-Fi. Switch to phone hotspot or VPN. Reload — you should stay signed in.
- Open the same session in a different browser → 401 (different `User-Agent` still rejects, as it should).
- Cookie tampered (change session cookie value) → 401.

### F3 · Composio webhook router mounted
`/webhooks/composio` is now wired and validates the Composio HMAC.

Prereq: set `COMPOSIO_WEBHOOK_SECRET` in `.env.local` to the value from your Composio dashboard, restart the API.

```bash
# 1. Missing secret → 503 (server intentionally fails closed)
unset COMPOSIO_WEBHOOK_SECRET    # or comment out in .env.local + restart
curl -i -X POST http://localhost:3001/webhooks/composio \
  -H 'webhook-id: x' -H 'webhook-timestamp: 0' -H 'webhook-signature: v1,zzz' \
  -d '{}'                                       # expect 503 webhook_not_configured

# 2. Bad signature → 401
curl -i -X POST http://localhost:3001/webhooks/composio \
  -H 'webhook-id: x' -H "webhook-timestamp: $(date +%s)" \
  -H 'webhook-signature: v1,bogus' -d '{}'      # expect 401 webhook_signature_invalid

# 3. Valid signature, unknown account → 200 + warn log
#    Generate the signature in Node:
#    crypto.createHmac('sha256', SECRET)
#          .update(`${id}.${ts}.${rawBody}`).digest('base64')
#    Then POST with `webhook-signature: v1,<base64>`. Expect 200 {ok:true}
#    and a `webhook_connection_unknown` log line.
```

End-to-end: register the webhook URL in your Composio dashboard. Trigger a Notion connect/disconnect. The API logs should print `webhook_kicked` and a workspace ingest cycle should start within a few seconds.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | web + api in parallel |
| `npm run dev:landing` / `dev:web` / `dev:api` | Run one app |
| `npm run db:up` | Start Postgres via `docker compose --env-file .env.local` |
| `npm run db:push` | Apply Drizzle schema (dev) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Generate / run migrations / browse DB |
| `npm run tenant:build` | Build the gbrain tenant image (default `linux/amd64`) |
| `npm run tenant:create:fly -- --owner-user-id <id>` | Create one Fly tenant Machine from env |
| `npm run typecheck` | TypeScript across all three workspaces |
| `npm run lint` | ESLint across all three workspaces |
| `npm run test` | Vitest (API workspace) |
| `npm run test:e2e` | Playwright |
| `npm run docs:install` / `docs:serve` / `docs:build` | MkDocs |

## Manual probes (not in CI)

- `./scripts/spike-gbrain-import-semantics.sh` — gbrain `import` upsert behavior
- `tsx scripts/spike-composio-tenant-isolation.ts` — Composio workspace isolation
- `tsx scripts/spike-composio-ratelimit.ts` — Composio rate-limit error shape

## Architecture notes

- **Two-boundary auth.** Open42 owns the user/session boundary (Supabase magic-link). gbrain owns the workspace MCP boundary (per-tenant OAuth DCR). The two are joined by an encrypted `gbrain_oauth_secret` row in `workspaces`.
- **Egress proxy is the only path to provider APIs.** Tenants ship with `OPENAI_API_KEY=<proxy-token>` and `OPENAI_BASE_URL=https://<api>/proxy/openai/v1`. A real provider key never lives in the tenant container.
- **Envelope encryption.** Per-row AES-GCM with AAD `${workspaceId}|${purpose}` and a per-tenant DEK derived via HKDF over the master KEK (`OPEN42_KEK`). Bumping the KEK invalidates all per-tenant secrets — see `apps/api/src/crypto/envelope.ts`.
- **Authorization claim.** Every route resolves the workspace through the `memberships` table, never through `users.currentWorkspaceId` (which is a UI hint and not authoritative). See `apps/api/src/auth/membership.ts`.

## License

TBD.
