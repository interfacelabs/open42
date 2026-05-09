import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

const CSRF_BYTES = 32;
const DEFAULT_TTL_DAYS = 30;

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  csrfToken: string;
  userAgent: string | null;
  ipFirstOctet: string | null;
}

export interface SessionRepo {
  create(record: Omit<SessionRecord, 'id'>): Promise<SessionRecord>;
  find(id: string): Promise<SessionRecord | null>;
  updateExpiry(id: string, expiresAt: Date): Promise<void>;
  invalidate(id: string): Promise<void>;
}

export function generateCsrfToken(): string {
  return randomBytes(CSRF_BYTES).toString('hex');
}

export function getIpFirstOctet(ip?: string | null): string | null {
  if (!ip) return null;
  const value = ip.split(',')[0]?.trim() ?? '';
  if (!value) return null;
  if (value.includes('.')) return value.split('.')[0] ?? null;
  return value.split(':')[0] ?? null;
}

export async function createSession(
  userId: string,
  meta: SessionMeta,
  repo: SessionRepo = createDrizzleSessionRepo(),
  now = new Date(),
): Promise<SessionRecord> {
  const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  return repo.create({
    userId,
    expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
    csrfToken: generateCsrfToken(),
    userAgent: meta.userAgent ?? null,
    ipFirstOctet: getIpFirstOctet(meta.ip),
  });
}

export async function validateSession(
  sessionId: string,
  meta: SessionMeta,
  repo: SessionRepo = createDrizzleSessionRepo(),
  now = new Date(),
): Promise<SessionRecord | null> {
  const session = await repo.find(sessionId);
  if (!session || session.expiresAt <= now) return null;
  if ((session.userAgent ?? '') !== (meta.userAgent ?? '')) return null;
  if ((session.ipFirstOctet ?? '') !== (getIpFirstOctet(meta.ip) ?? '')) return null;

  const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  const nextExpiry = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  await repo.updateExpiry(session.id, nextExpiry);
  return { ...session, expiresAt: nextExpiry };
}

export async function invalidateSession(
  sessionId: string,
  repo: SessionRepo = createDrizzleSessionRepo(),
): Promise<void> {
  await repo.invalidate(sessionId);
}

function createDrizzleSessionRepo(): SessionRepo {
  return {
    async create(record) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      const [session] = await defaultDb
        .insert(schema.sessions)
        .values(record)
        .returning();
      if (!session) throw new Error('session_insert_failed');
      return session;
    },
    async find(id) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      const [session] = await defaultDb
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .limit(1);
      return session ?? null;
    },
    async updateExpiry(id, expiresAt) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      await defaultDb.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, id));
    },
    async invalidate(id) {
      const { db: defaultDb, schema } = await import('../db/client.js');
      await defaultDb
        .update(schema.sessions)
        .set({ expiresAt: new Date(0) })
        .where(eq(schema.sessions.id, id));
    },
  };
}
