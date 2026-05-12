import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { readKek } from '../crypto/envelope.js';

const TOKEN_PREFIX = 'tnt';
const TOKEN_RANDOM_BYTES = 16;
const TOKEN_PATTERN = /^tnt_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{32})$/i;

export function generateProxyToken(workspaceId: string): { token: string; hash: Buffer } {
  const token = `${TOKEN_PREFIX}_${workspaceId}_${randomBytes(TOKEN_RANDOM_BYTES).toString('hex')}`;
  return { token, hash: hashProxyTokenForStorage(token) };
}

export function hashProxyTokenForStorage(token: string): Buffer {
  return hmacProxyToken(token);
}

export async function verifyProxyToken(
  token: string,
): Promise<{ workspaceId: string } | null> {
  const parsed = parseProxyToken(token);
  if (!parsed) return null;

  const { db, schema } = await import('../db/client.js');
  const [workspace] = await db
    .select({
      id: schema.workspaces.id,
      proxyTokenHash: schema.workspaces.proxyTokenHash,
    })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, parsed.workspaceId),
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .limit(1);

  const storedHash = workspace?.proxyTokenHash;
  if (!storedHash) return null;

  const expected = Buffer.from(storedHash);
  const actual = hmacProxyToken(token);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return { workspaceId: parsed.workspaceId };
}

function parseProxyToken(token: string): { workspaceId: string } | null {
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match?.[1]) return null;
  return { workspaceId: match[1].toLowerCase() };
}

function hmacProxyToken(token: string): Buffer {
  return createHmac('sha256', readKek()).update(token, 'utf8').digest();
}
