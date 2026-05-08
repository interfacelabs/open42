import express from 'express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../env.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const mocks = vi.hoisted(() => ({
  verifySupabaseIdentity: vi.fn(),
  sendSupabaseMagicLink: vi.fn(),
}));

vi.mock('../auth/supabase.js', () => ({
  verifySupabaseIdentity: mocks.verifySupabaseIdentity,
  sendSupabaseMagicLink: mocks.sendSupabaseMagicLink,
}));

describeDb('auth routes', () => {
  let mod: typeof import('./auth.js');
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./auth.js');
    dbMod = await import('../db/client.js');
  });

  afterEach(async () => {
    mocks.verifySupabaseIdentity.mockReset();
    mocks.sendSupabaseMagicLink.mockReset();
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.sessions).where(eq(dbMod.schema.sessions.userId, userId));
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  it('links an existing email-only user to the verified Supabase identity', async () => {
    const email = `auth-link-${Date.now()}-${Math.random()}@open42.test`;
    const [existing] = await dbMod.db.insert(dbMod.schema.users).values({ email }).returning();
    if (!existing) throw new Error('user insert failed');
    userIds.push(existing.id);

    mocks.verifySupabaseIdentity.mockResolvedValue({
      supabaseUserId: 'supabase-user-existing-email',
      email,
    });

    const app = express();
    app.use(express.json());
    app.use('/auth', mod.authRouter);

    const res = await request(app)
      .post('/auth/verify')
      .set('User-Agent', 'auth-route-test')
      .send({ accessToken: 'jwt' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, redirectTo: '/auth/onboard' });
    expect(String(res.headers['set-cookie'])).toContain('open42_session=');

    const [updated] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, existing.id))
      .limit(1);
    expect(updated?.supabaseUserId).toBe('supabase-user-existing-email');
  });
});
