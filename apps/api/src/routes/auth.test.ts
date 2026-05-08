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
  const workspaceIds: string[] = [];
  const inviteIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./auth.js');
    dbMod = await import('../db/client.js');
  });

  afterEach(async () => {
    mocks.verifySupabaseIdentity.mockReset();
    mocks.sendSupabaseMagicLink.mockReset();
    for (const inviteId of inviteIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, inviteId));
    }
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, workspaceId));
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.sessions).where(eq(dbMod.schema.sessions.userId, userId));
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth', mod.authRouter);
    return app;
  }

  async function seedUser(email: string, supabaseUserId?: string) {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email, supabaseUserId })
      .returning();
    if (!user) throw new Error('seedUser failed');
    userIds.push(user.id);
    return user;
  }

  async function seedWorkspace(ownerUserId: string, name = 'X') {
    const [ws] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId,
        name,
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.27.1',
        status: 'provisioning',
      })
      .returning();
    if (!ws) throw new Error('seedWorkspace failed');
    workspaceIds.push(ws.id);
    return ws;
  }

  async function seedInvite(input: {
    workspaceId: string;
    email: string;
    invitedByUserId: string;
    status?: 'pending' | 'accepted' | 'revoked';
  }) {
    const [invite] = await dbMod.db
      .insert(dbMod.schema.workspaceInvites)
      .values({
        workspaceId: input.workspaceId,
        email: input.email,
        invitedByUserId: input.invitedByUserId,
        role: 'member',
        status: input.status ?? 'pending',
      })
      .returning();
    if (!invite) throw new Error('seedInvite failed');
    inviteIds.push(invite.id);
    return invite;
  }

  it('links an existing email-only user to the verified Supabase identity', async () => {
    const email = `auth-link-${Date.now()}-${Math.random()}@open42.test`;
    const [existing] = await dbMod.db.insert(dbMod.schema.users).values({ email }).returning();
    if (!existing) throw new Error('user insert failed');
    userIds.push(existing.id);

    const supabaseUserId = `supabase-user-existing-email-${Date.now()}-${Math.random()}`;
    mocks.verifySupabaseIdentity.mockResolvedValue({
      supabaseUserId,
      email,
    });

    const res = await request(buildApp())
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
    expect(updated?.supabaseUserId).toBe(supabaseUserId);
  });

  describe('POST /auth/verify - invite acceptance', () => {
    it('happy path: invitee becomes member, invite marked accepted', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const ws = await seedWorkspace(inviter.id, 'X');
      const invite = await seedInvite({
        workspaceId: ws.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
      });

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_b_${tag}`,
        email: inviteeEmail,
      });

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

      expect(res.status).toBe(200);
      expect(res.body.redirectTo).toBe('/auth/home');

      const [invitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, inviteeEmail))
        .limit(1);
      expect(invitee).toBeDefined();
      if (invitee) userIds.push(invitee.id);

      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships.some((m) => m.userId === invitee?.id && m.role === 'member')).toBe(true);

      const [refreshed] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(refreshed?.status).toBe('accepted');
    });

    it('expired token returns invite_expired', async () => {
      mocks.verifySupabaseIdentity.mockRejectedValue(new Error('supabase_otp_expired'));

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({
          tokenHash: 'xyz',
          type: 'invite',
          inviteId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invite_expired');
    });

    it('email mismatch returns invite_email_mismatch', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const wrongEmail = `auth-invite-wrong-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const ws = await seedWorkspace(inviter.id, 'X');
      const invite = await seedInvite({
        workspaceId: ws.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
      });

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_c_${tag}`,
        email: wrongEmail,
      });

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invite_email_mismatch');

      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([]);

      const [stillPending] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(stillPending?.status).toBe('pending');

      // Wrong-email user gets created by upsertUser; track for cleanup.
      const [wrongUser] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, wrongEmail))
        .limit(1);
      if (wrongUser) userIds.push(wrongUser.id);
    });

    it('user already owns a workspace returns invite_blocked', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const invitee = await seedUser(inviteeEmail, `sb_user_b_${tag}`);
      const inviterWs = await seedWorkspace(inviter.id, 'Inviter ws');
      await seedWorkspace(invitee.id, 'Invitee own ws');
      const invite = await seedInvite({
        workspaceId: inviterWs.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
      });

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_b_${tag}`,
        email: inviteeEmail,
      });

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('invite_blocked');
      expect(res.body.reason).toBe('user_already_has_workspace');

      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, inviterWs.id));
      expect(memberships).toEqual([]);

      const [stillPending] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(stillPending?.status).toBe('pending');
    });

    it('already-accepted invite is idempotent', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const ws = await seedWorkspace(inviter.id, 'X');
      const invite = await seedInvite({
        workspaceId: ws.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
        status: 'accepted',
      });

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_b_${tag}`,
        email: inviteeEmail,
      });

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

      expect(res.status).toBe(200);
      expect(res.body.redirectTo).toBe('/auth/home');

      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([]);

      const [invitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, inviteeEmail))
        .limit(1);
      if (invitee) userIds.push(invitee.id);
    });
  });
});
