# Open42 Engineering Docs

These docs describe the repository as it is implemented today. They are written
from the code, configuration, migrations, and test surfaces in this repo.

Open42 is a monorepo with:

- `apps/api`: Express, Drizzle, auth, connectors, gbrain integration, provider proxy, queues.
- `apps/web`: Next.js Pages Router application and thin API proxy routes.
- `apps/landing`: public marketing site.
- `apps/mobile`: Expo prototype.
- `packages/cloud`: cloud-only API, web, migrations, and Fly/Stripe integrations.
- `packages/cloud-stubs`: no-op community shims for cloud imports.
- `infra`: Docker images for API, web, and gbrain tenant runtime.
- `scripts`: local setup, development, and tenant-image helpers.

## Edition Model

The default edition is `community`. It is self-host-oriented, single-workspace by
default, and BYOK-first. Cloud behavior is loaded only when
`OPEN42_EDITION=cloud`.

The edition boundary exists in both the API and web build:

- The API dynamically imports `@open42/cloud/api` only in cloud mode.
- The web app aliases `@open42/cloud` to `packages/cloud` or
  `packages/cloud-stubs` from `apps/web/next.config.js`.
- Cloud-only dependencies are installed separately under `packages/cloud/api`.

## Documentation Sets

This internal docs site covers the full repo, including cloud-only package
boundaries. The `public-docs/` site is intentionally limited to community
self-hosting and omits cloud-only operations.

No secrets, production values, private API tokens, or local `.env` values should
be committed to either docs tree.
