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
export const OPEN42_INGEST_HMAC_SECRET = process.env.OPEN42_INGEST_HMAC_SECRET ?? '';
export const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? '3001'}`
).replace(/\/+$/, '');
export const WEB_PUBLIC_URL = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
