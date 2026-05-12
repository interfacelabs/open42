# Open42 Self-Hosted

Open42 community edition is the self-hostable Company Brain. It runs the Open42
web app, API, metadata database, queue, and a gbrain runtime on your own
infrastructure.

This public docs site covers only the self-hosted community edition.

## What You Run

The self-host Compose stack includes:

- Open42 web app on port `3000`.
- Open42 API on port `3001`.
- Postgres for Open42 metadata.
- Redis for the provisioning queue.
- gbrain runtime on port `8080`.

## What You Bring

- A Supabase project for magic-link authentication.
- Workspace provider keys added in Open42 settings after sign-in.
- Docker and Node.js 20+ for local setup.

## Default Security Posture

Community self-hosting is BYOK by default. Open42 does not use shared server
provider keys unless you explicitly enable that behavior.

## Next Step

Start with [Install](install.md).
