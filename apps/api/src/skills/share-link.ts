import { createHash, randomBytes as defaultRandomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db as defaultDb, schema } from '../db/client.js';

export const SHARE_LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const SHARE_LINK_RATE_LIMIT = 10;
export const SHARE_LINK_RATE_LIMIT_WINDOW_MS = 60_000;

interface RateEntry {
  count: number;
  resetAt: number;
}

const shareMintRateLimit = new Map<string, RateEntry>();

export type ShareLinkRateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfter: number };

export interface MintShareLinkInput {
  workspaceId: string;
  skillId: string;
  skillVersionId: string;
  createdByUserId: string;
  bundle: Buffer;
  publicBaseUrl: string;
}

export interface MintShareLinkDeps {
  db?: typeof defaultDb;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

export interface MintShareLinkResult {
  token: string;
  url: string;
  expiresAt: Date;
  storageKey: string;
}

export interface ResolveShareLinkDeps {
  db?: typeof defaultDb;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface ResolvedShareLink {
  filename: string;
  bundle: Buffer;
  expiresAt: Date;
}

export function checkShareLinkRateLimit(
  workspaceId: string,
  nowMs = Date.now(),
): ShareLinkRateLimitResult {
  const existing = shareMintRateLimit.get(workspaceId);
  const entry =
    existing && existing.resetAt > nowMs
      ? existing
      : { count: 0, resetAt: nowMs + SHARE_LINK_RATE_LIMIT_WINDOW_MS };

  if (entry.count + 1 > SHARE_LINK_RATE_LIMIT) {
    shareMintRateLimit.set(workspaceId, entry);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)) };
  }

  entry.count += 1;
  shareMintRateLimit.set(workspaceId, entry);
  return { ok: true, remaining: SHARE_LINK_RATE_LIMIT - entry.count };
}

export function resetShareLinkRateLimitForTest(): void {
  shareMintRateLimit.clear();
}

export async function mintShareLink(
  input: MintShareLinkInput,
  deps: MintShareLinkDeps = {},
): Promise<MintShareLinkResult> {
  const now = deps.now?.() ?? new Date();
  const limited = checkShareLinkRateLimit(input.workspaceId, now.getTime());
  if (!limited.ok) {
    const err = new Error('share_link_rate_limited') as Error & { retryAfter?: number };
    err.retryAfter = limited.retryAfter;
    throw err;
  }

  const randomBytes = deps.randomBytes ?? defaultRandomBytes;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashShareToken(token);
  const expiresAt = new Date(now.getTime() + SHARE_LINK_TTL_MS);
  const storageKey = buildShareStorageKey({
    workspaceId: input.workspaceId,
    skillId: input.skillId,
    skillVersionId: input.skillVersionId,
  });

  await writeBundle(storageKey, input.bundle, deps.env);
  await (deps.db ?? defaultDb).insert(schema.skillShareLinks).values({
    workspaceId: input.workspaceId,
    skillId: input.skillId,
    skillVersionId: input.skillVersionId,
    createdByUserId: input.createdByUserId,
    tokenHash,
    storageKey,
    expiresAt,
  });

  return {
    token,
    url: `${input.publicBaseUrl.replace(/\/+$/, '')}/shared/${token}.zip`,
    expiresAt,
    storageKey,
  };
}

export async function resolveShareLink(
  token: string,
  deps: ResolveShareLinkDeps = {},
): Promise<ResolvedShareLink | null> {
  const now = deps.now?.() ?? new Date();
  const tokenHash = hashShareToken(token);
  const db = deps.db ?? defaultDb;
  const [row] = await db
    .select({
      id: schema.skillShareLinks.id,
      storageKey: schema.skillShareLinks.storageKey,
      expiresAt: schema.skillShareLinks.expiresAt,
      skillId: schema.skillShareLinks.skillId,
    })
    .from(schema.skillShareLinks)
    .where(
      and(
        eq(schema.skillShareLinks.tokenHash, tokenHash),
        gt(schema.skillShareLinks.expiresAt, now),
        isNull(schema.skillShareLinks.revokedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  await db
    .update(schema.skillShareLinks)
    .set({ lastUsedAt: now })
    .where(eq(schema.skillShareLinks.id, row.id));

  return {
    filename: `${row.skillId}.zip`,
    bundle: await readBundle(row.storageKey, deps.env),
    expiresAt: row.expiresAt,
  };
}

export function hashShareToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function buildShareStorageKey(input: {
  workspaceId: string;
  skillId: string;
  skillVersionId: string;
}): string {
  return `${input.workspaceId}/${input.skillId}/${input.skillVersionId}.zip`;
}

export async function writeBundle(
  storageKey: string,
  bundle: Buffer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = bundlePath(storageKey, env);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bundle, { mode: 0o600 });
}

export async function readBundle(
  storageKey: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Buffer> {
  return readFile(bundlePath(storageKey, env));
}

function bundlePath(storageKey: string, env: NodeJS.ProcessEnv): string {
  const root = resolve(
    env.OPEN42_SKILL_BUNDLE_STORE_DIR ??
      (env.NODE_ENV === 'production'
        ? '/data/open42/skill-bundles'
        : join(process.cwd(), '.open42-skill-bundles')),
  );
  const normalizedKey = normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = resolve(root, normalizedKey);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('invalid_storage_key');
  return path;
}
