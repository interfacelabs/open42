# Install

## Quick Install (macOS or Ubuntu)

From a fresh clone:

```bash
bash scripts/install.sh
```

Or from a clean machine, once we publish the script:

```bash
curl -fsSL https://raw.githubusercontent.com/interfacelabs/open42/main/scripts/install.sh | bash
```

The installer:

1. Detects your OS and verifies prerequisites (Git, curl, Node 20+, Docker, the
   `docker compose` v2 plugin, and a running Docker daemon). If anything is
   missing it prints the exact install command for your platform and exits.
   It does **not** run `sudo` for you.
2. Clones the repo if you are not already inside a checkout.
3. Runs `npm install`.
4. Prompts for your Supabase values and (optionally) provider API keys.
5. Generates Open42 secrets and writes `.env`.
6. Builds the gbrain tenant image.
7. Starts the community stack with `docker compose -f docker-compose.community.yml up --build -d`.
8. Waits for `/healthz` and prints the sign-in URL.

Useful flags:

| Flag                | Behavior                                                    |
| ------------------- | ----------------------------------------------------------- |
| `--no-start`        | Generate `.env` and stop before `docker compose up`.        |
| `--skip-prereqs`    | Trust the host environment and skip the prerequisite check. |
| `--repo-dir <path>` | Clone into `<path>` when running outside a checkout.        |

## Prerequisites

If you prefer to set things up by hand:

- Node.js 20 or newer.
- npm.
- Docker with the `docker compose` v2 plugin.
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

To also prompt for optional Anthropic and OpenAI keys at install time:

```bash
npm run setup -- --ask-provider-keys
```

If you provide a provider key this way, the installer sets
`OPEN42_ALLOW_SHARED_KEYS=true` so the stack can use those server-side keys.
Leave them blank to stay BYOK-first and add keys in Settings after sign-in.

To print generated values without writing `.env`:

```bash
npm run setup -- --print
```

To write a different file:

```bash
npm run setup -- --env-path /path/to/open42.env
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
