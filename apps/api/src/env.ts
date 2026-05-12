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
export const OPEN42_EDITION = parseEdition(process.env.OPEN42_EDITION);
export const OPEN42_ALLOW_MULTI_WORKSPACE = boolEnv(
  process.env.OPEN42_ALLOW_MULTI_WORKSPACE,
  OPEN42_EDITION === 'cloud',
);
export const OPEN42_ALLOW_SHARED_KEYS = boolEnv(
  process.env.OPEN42_ALLOW_SHARED_KEYS,
  OPEN42_EDITION === 'cloud',
);
export const OPEN42_DISABLE_COMPOSIO = boolEnv(process.env.OPEN42_DISABLE_COMPOSIO, false);
export const OPEN42_COMPOSIO_ENABLED = Boolean(COMPOSIO_API_KEY) && !OPEN42_DISABLE_COMPOSIO;
export const OPEN42_INGEST_HMAC_SECRET = process.env.OPEN42_INGEST_HMAC_SECRET ?? '';
export const OPEN42_SINGLE_WORKSPACE_ID = process.env.OPEN42_SINGLE_WORKSPACE_ID ?? '';
export const OPEN42_TENANT_PROXY_TOKEN = process.env.OPEN42_TENANT_PROXY_TOKEN ?? '';
export const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
export const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? '3001'}`
).replace(/\/+$/, '');
export const WEB_PUBLIC_URL = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
export const REDIS_URL =
  process.env.REDIS_URL ?? `redis://localhost:${process.env.REDIS_HOST_PORT ?? '63799'}`;
export function assertBootSecrets(env: NodeJS.ProcessEnv = process.env): void {
  assertRequiredSecret(env.OPEN42_KEK, 'OPEN42_KEK');
  assertRequiredSecret(env.SESSION_SECRET, 'SESSION_SECRET');
}

function parseEdition(value: string | undefined): 'community' | 'cloud' {
  if (!value) return 'community';
  if (value === 'community' || value === 'cloud') return value;
  throw new Error('OPEN42_EDITION must be "community" or "cloud"');
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}

function assertRequiredSecret(value: string | undefined, name: string): void {
  const trimmed = value?.trim() ?? '';
  if (
    !trimmed ||
    ['replace-me', 'replace-with-32-byte-hex-key', 'changeme', 'change-me'].includes(
      trimmed.toLowerCase(),
    )
  ) {
    throw new Error(`${name} is required; run npm run setup for self-hosted installs`);
  }
}
