import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

export const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY ?? '';
export const COMPOSIO_BASE_URL = process.env.COMPOSIO_BASE_URL || undefined;
export const COMPOSIO_NOTION_AUTH_CONFIG_ID = process.env.COMPOSIO_NOTION_AUTH_CONFIG_ID ?? '';
export const COMPOSIO_WEBHOOK_SECRET = process.env.COMPOSIO_WEBHOOK_SECRET ?? '';
export const OPEN42_INGEST_HMAC_SECRET = process.env.OPEN42_INGEST_HMAC_SECRET ?? '';
export const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? '3001'}`
).replace(/\/+$/, '');
export const WEB_PUBLIC_URL = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
export const REDIS_URL =
  process.env.REDIS_URL ?? `redis://localhost:${process.env.REDIS_HOST_PORT ?? '63799'}`;
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
export const STRIPE_BASIC_MONTHLY_PRICE_ID = process.env.STRIPE_BASIC_MONTHLY_PRICE_ID ?? '';
export const STRIPE_PLATFORM_REQUEST_METERED_PRICE_ID =
  process.env.STRIPE_PLATFORM_REQUEST_METERED_PRICE_ID ?? '';
export const STRIPE_PLATFORM_REQUEST_METER_EVENT_NAME =
  process.env.STRIPE_PLATFORM_REQUEST_METER_EVENT_NAME ?? '';
export const OPEN42_BASIC_INCLUDED_REQUESTS = process.env.OPEN42_BASIC_INCLUDED_REQUESTS ?? '0';
