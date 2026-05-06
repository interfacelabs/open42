import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { db as defaultDb, schema } from '../db/client.js';

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 15;

export interface MagicLinkRecord {
  token: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface MagicLinkRepo {
  create(record: MagicLinkRecord): Promise<void>;
  findUnused(token: string): Promise<MagicLinkRecord | null>;
  markUsed(token: string, usedAt: Date): Promise<void>;
}

export function generateMagicLinkToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export async function createMagicLink(
  email: string,
  repo: MagicLinkRepo = createDrizzleMagicLinkRepo(),
  now = new Date(),
): Promise<MagicLinkRecord> {
  const normalizedEmail = normalizeEmail(email);
  const ttl = Number(process.env.MAGIC_LINK_TTL_MINUTES ?? DEFAULT_TTL_MINUTES);
  const record = {
    token: generateMagicLinkToken(),
    email: normalizedEmail,
    expiresAt: new Date(now.getTime() + ttl * 60 * 1000),
    usedAt: null,
  };
  await repo.create(record);
  return record;
}

export async function consumeMagicLink(
  token: string,
  repo: MagicLinkRepo = createDrizzleMagicLinkRepo(),
  now = new Date(),
): Promise<MagicLinkRecord> {
  const record = await repo.findUnused(token);
  if (!record) {
    throw new Error('magic_link_invalid');
  }
  if (record.expiresAt <= now) {
    throw new Error('magic_link_expired');
  }

  await repo.markUsed(token, now);
  return { ...record, usedAt: now };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('email_invalid');
  }
  return normalized;
}

function createDrizzleMagicLinkRepo(): MagicLinkRepo {
  return {
    async create(record) {
      await defaultDb.insert(schema.magicLinks).values(record);
    },
    async findUnused(token) {
      const [record] = await defaultDb
        .select()
        .from(schema.magicLinks)
        .where(and(eq(schema.magicLinks.token, token), isNull(schema.magicLinks.usedAt)))
        .limit(1);
      return record ?? null;
    },
    async markUsed(token, usedAt) {
      await defaultDb
        .update(schema.magicLinks)
        .set({ usedAt })
        .where(and(eq(schema.magicLinks.token, token), isNull(schema.magicLinks.usedAt)));
    },
  };
}
