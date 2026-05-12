# Install

## Prerequisites

- Node.js 20 or newer.
- npm.
- Docker with Compose support.
- A Supabase project.

## Create Supabase Values

Create a Supabase project and collect:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

These values are required for magic-link sign-in and invite links.

## Generate Local Environment

From the repo root:

```bash
npm install
npm run setup
```

`npm run setup` writes `.env`, generates Open42 secrets, and asks for your
Supabase values. The first person who signs in becomes the workspace owner.

To print generated values without writing `.env`:

```bash
npm run setup -- --print
```

To write a different file:

```bash
npm run setup -- --env-file /path/to/open42.env
```

## Start The Stack

```bash
docker compose -f docker-compose.community.yml up --build
```

Open the app:

```text
http://localhost:3000/sign_in
```

After sign-in, go to Settings and add provider keys before using chat or ingest.

## Stop The Stack

```bash
docker compose -f docker-compose.community.yml down
```

To delete all data, include volumes:

```bash
docker compose -f docker-compose.community.yml down -v
```
