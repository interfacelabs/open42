# Verification

## Required Checks

Run these before shipping code changes:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Edition Checks

Community:

```bash
npm run typecheck:community
npm run lint:community
npm run test:community
npm run build:community
```

Cloud:

```bash
npm install --prefix packages/cloud/api --ignore-scripts
npm run typecheck:cloud
npm run lint:cloud
npm run test:cloud
npm run build:cloud
```

## Public And Internal Docs

Install MkDocs tooling once:

```bash
npm run docs:install
```

Build internal docs:

```bash
npm run docs:build
```

Build public self-host docs:

```bash
npm run docs:build:public
```

## CI

GitHub Actions runs a matrix for `community` and `cloud` on pull requests and
pushes to `main`. The community job also checks that Stripe is not present in
the community dependency tree.
