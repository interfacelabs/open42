# Cloud Operations

Cloud code is isolated under `packages/cloud` and only loads with
`OPEN42_EDITION=cloud`.

## Cloud API Package

The cloud API package is compiled before runtime:

```bash
npm run build:cloud-api
```

`packages/cloud/package.json` exports `./api` from `packages/cloud/api/dist`.
Cloud dependencies such as Stripe are installed under `packages/cloud/api`.

## Cloud Migrations

Cloud migration deploys use a generated bundled folder:

```bash
node packages/cloud/scripts/prepare-migrations.mjs
npm run db:migrate:cloud -w @open42/api
```

The bundler concatenates community migrations with migrations in
`packages/cloud/migrations`.

## Cloud Runtime Hooks

`packages/cloud/api/index.ts` registers:

- cloud LLM usage recorder.
- Fly tenant provisioner.
- Stripe webhook routes.
- workspace billing routes.
- billing usage retry loop.

The API dynamic import in `apps/api/src/index.ts` ensures these hooks do not
load in community mode.

## Cloud Docker Target

`infra/Dockerfile.api` has separate `community` and `cloud` targets. The cloud
target builds the API, compiles the cloud API package, copies cloud migrations,
and starts with cloud migration execution.
