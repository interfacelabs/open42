# Operations

## Start

```bash
docker compose -f docker-compose.community.yml up --build
```

## Migrate The Database

The API image runs migrations on startup. To run them manually from a local
checkout:

```bash
npm run db:migrate
```

For development only, you can push the current schema:

```bash
npm run db:push
```

## Build The gbrain Tenant Image

```bash
npm run tenant:build
```

The default gbrain version is pinned by `GBRAIN_VERSION`.

## Backups

Back up:

- Open42 Postgres volume.
- gbrain data volume.
- `.env` or the secret store containing equivalent values.

Redis is used for queue durability, but Postgres and gbrain data are the core
state.

## Upgrades

1. Pull the new Open42 version.
2. Review `.env.community.example` for new variables.
3. Rebuild and start the Compose stack.
4. Confirm the API health endpoint responds.
5. Sign in and verify chat, connectors, and Settings.

## Health Checks

API:

```text
http://localhost:3001/healthz
```

Web:

```text
http://localhost:3000
```

gbrain:

```text
http://localhost:8080/health
```
