# Local Development

## Prerequisites

- Node.js 20 or newer.
- npm.
- Docker.
- A Postgres-compatible database for Open42 metadata.
- Redis for the provisioning queue.
- Supabase project values for magic-link auth.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:push
npm run dev
```

`npm run db:up` starts local Postgres and Redis using `docker-compose.yml`.
The default Postgres host port is `54338`; the default Redis host port is
`63799`.

## Development Servers

| Command               | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`         | Runs web and API together.                                                     |
| `npm run dev:cloud`   | Runs web and API in cloud mode with paid upgrades enabled for sandbox testing. |
| `npm run dev:web`     | Runs the Next.js web app.                                                      |
| `npm run dev:api`     | Runs the Express API with `tsx watch`.                                         |
| `npm run dev:landing` | Runs the landing site.                                                         |
| `npm run dev:stripe`  | Runs Stripe CLI webhook forwarding to the local API.                           |

## Database Commands

| Command               | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `npm run db:push`     | Push current Drizzle schema for development. |
| `npm run db:generate` | Generate migrations from schema changes.     |
| `npm run db:migrate`  | Apply committed community migrations.        |
| `npm run db:studio`   | Open Drizzle Studio.                         |

## Tenant Runtime

For local development, `TENANT_PROVISIONER=local-docker` starts a local gbrain
container per workspace. For self-host Compose, `TENANT_PROVISIONER=compose`
uses the shared `gbrain` service.

Build the tenant image with:

```bash
npm run tenant:build
```

## Stripe Sandbox Checkout

Open42 Cloud uses Stripe-hosted Checkout. Local sandbox testing needs a Stripe
test-mode secret key, a test-mode recurring price, and a Stripe CLI webhook
listener.

1. In the Stripe Dashboard, switch to test mode and create a product named
   `Open42 Cloud Beta` with a recurring monthly price of `$20`. Copy the
   test-mode price ID (`price_...`).

2. Install and authenticate the Stripe CLI:

   ```bash
   stripe login
   ```

3. Add test-mode Stripe values to `.env.local`:

   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_BASIC_MONTHLY_PRICE_ID=price_...
   # Filled after starting the Stripe listener below.
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   Optional: set `STRIPE_CLI_API_KEY=sk_test_...` if you want
   `npm run dev:stripe` to force a specific sandbox key instead of using the
   account selected by `stripe login`.

4. Start Stripe webhook forwarding in one terminal:

   ```bash
   npm run dev:stripe
   ```

   The command forwards these events to
   `http://localhost:3001/webhooks/stripe`:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`

   Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` in
   `.env.local`. Keep the listener running while testing.

5. Apply cloud migrations locally and start Open42 in cloud mode:

   ```bash
   npm run db:up
   npm run db:migrate:cloud -w @open42/api
   npm run dev:cloud
   ```

6. Visit `http://localhost:3000`, create a paid workspace, and use a Stripe
   test card in Checkout, for example `4242 4242 4242 4242`. The successful
   webhook should move the workspace from `billing_required` to `provisioning`.

The local CLI webhook signing secret is different from the live Dashboard
webhook secret. Do not use the production `whsec_...` value for local CLI
testing.
