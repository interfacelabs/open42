import express from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const gateEnvKeys = [
    'OPEN42_EDITION',
    'OPEN42_ENABLE_OPEN_SIGNUPS',
    'OPEN42_ALLOWED_EMAILS',
    'OPEN42_ALLOWED_EMAIL_DOMAINS',
  ] as const;
  let gateEnvSnapshot = {} as Record<(typeof gateEnvKeys)[number], string | undefined>;

  beforeAll(async () => {
    mod = await import('./auth.js');
    dbMod = await import('../db/client.js');
  });

  beforeEach(() => {
    gateEnvSnapshot = snapshotGateEnv();
    process.env.OPEN42_EDITION = 'cloud';
    process.env.OPEN42_ENABLE_OPEN_SIGNUPS = 'true';
    process.env.OPEN42_ALLOWED_EMAILS = '';
    process.env.OPEN42_ALLOWED_EMAIL_DOMAINS = '';
  });

  afterEach(async () => {
    restoreGateEnv(gateEnvSnapshot);
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
    app.use(cookieParser());
    app.use('/auth', mod.authRouter);
    return app;
  }

  function snapshotGateEnv(): Record<(typeof gateEnvKeys)[number], string | undefined> {
    return Object.fromEntries(gateEnvKeys.map((key) => [key, process.env[key]])) as Record<
      (typeof gateEnvKeys)[number],
      string | undefined
    >;
  }

  function restoreGateEnv(snapshot: Record<(typeof gateEnvKeys)[number], string | undefined>) {
    for (const key of gateEnvKeys) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: 'provisioning',
      })
      .returning();
    if (!ws) throw new Error('seedWorkspace failed');
    workspaceIds.push(ws.id);
    // Membership is the authorization claim — see apps/api/src/auth/membership.ts.
    // Workspace creation in production always inserts owner+membership atomically
    // (saveWorkspaceName), so the test fixture mirrors that invariant.
    await dbMod.db
      .insert(dbMod.schema.memberships)
      .values({ userId: ownerUserId, workspaceId: ws.id, role: 'owner' })
      .onConflictDoNothing();
    return ws;
  }

  async function seedInvite(input: {
    workspaceId: string;
    email: string;
    invitedByUserId: string;
    status?: 'pending' | 'accepted' | 'revoked';
    createdAt?: Date;
  }) {
    const [invite] = await dbMod.db
      .insert(dbMod.schema.workspaceInvites)
      .values({
        workspaceId: input.workspaceId,
        email: input.email,
        invitedByUserId: input.invitedByUserId,
        role: 'member',
        status: input.status ?? 'pending',
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
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
    expect(res.body).toEqual({ ok: true, redirectTo: '/onboard' });
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
      process.env.OPEN42_ENABLE_OPEN_SIGNUPS = 'false';
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
      expect(res.body.redirectTo).toBe('/');

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

      // Codex round-2 P2: Path A (signed-out invite accept) must update
      // users.current_workspace_id so the user lands on the workspace they
      // just joined — matching Path B (signed-in fast-path in accept.ts).
      const [refreshedInvitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.id, invitee!.id))
        .limit(1);
      expect(refreshedInvitee?.currentWorkspaceId).toBe(ws.id);
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

      // Only the owner's seeded membership should exist — no member row added.
      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([expect.objectContaining({ userId: inviter.id, role: 'owner' })]);

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

    it('accepts the invite even when the user already owns another workspace (B2 multi-workspace)', async () => {
      // Pre-B2 the route short-circuited with `invite_blocked` whenever the
      // invitee already owned any workspace. B2 enables multi-workspace
      // membership, so that gate is gone — accepting an invite to a SECOND
      // workspace is now a normal 200 + new owner-of-A + member-of-B graph.
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const invitee = await seedUser(inviteeEmail, `sb_user_b_${tag}`);
      const inviterWs = await seedWorkspace(inviter.id, 'Inviter ws');
      const inviteeOwnWs = await seedWorkspace(invitee.id, 'Invitee own ws');
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

      expect(res.status).toBe(200);
      expect(res.body.redirectTo).toBe('/');

      // The invitee now has TWO memberships: owner of their original
      // workspace, member of the inviter's workspace.
      const inviterMemberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, inviterWs.id));
      expect(inviterMemberships.some((m) => m.userId === invitee.id && m.role === 'member')).toBe(
        true,
      );

      const ownMemberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, inviteeOwnWs.id));
      expect(ownMemberships.some((m) => m.userId === invitee.id && m.role === 'owner')).toBe(true);

      const [refreshed] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(refreshed?.status).toBe('accepted');

      // Codex round-2 P2: current_workspace_id moves to the invited workspace
      // (NOT the user's previously-owned one). This is the entire reason the
      // update is in the transaction — UI hint must agree with redirectTo='/'.
      const [refreshedInvitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.id, invitee.id))
        .limit(1);
      expect(refreshedInvitee?.currentWorkspaceId).toBe(inviterWs.id);
    });

    it('rejects an invite older than 24h with invite_expired (codex round-4 P2)', async () => {
      // Path A (signed-out invite accept) must enforce the same server-side
      // 24h TTL as Path B (apps/api/src/routes/workspaces/accept.ts) so the
      // two flows can't diverge on age.
      const tag = `${Date.now()}-${Math.random()}`;
      const inviterEmail = `auth-invite-inviter-${tag}@open42.test`;
      const inviteeEmail = `auth-invite-invitee-${tag}@open42.test`;
      const inviter = await seedUser(inviterEmail, `sb_user_a_${tag}`);
      const ws = await seedWorkspace(inviter.id, 'X');
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const invite = await seedInvite({
        workspaceId: ws.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
        createdAt: twentyFiveHoursAgo,
      });

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_b_${tag}`,
        email: inviteeEmail,
      });

      const res = await request(buildApp())
        .post('/auth/verify')
        .set('User-Agent', 'auth-route-test')
        .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invite_expired');

      // No membership row added — only the seeded owner membership.
      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([expect.objectContaining({ userId: inviter.id, role: 'owner' })]);

      // Invite stayed pending (we don't revoke it on expiry — the row is
      // still there for the admin's records).
      const [stillPending] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(stillPending?.status).toBe('pending');

      // Track the upsertUser-created user for cleanup.
      const [invitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, inviteeEmail))
        .limit(1);
      if (invitee) userIds.push(invitee.id);
    });

    // Codex round-8 P2: simulate the race where revoke commits between the
    // outer `db.select(invite)` and the transaction body. Pre-fix the
    // transaction read its decision off the stale `invite` row from the
    // outer scope and overwrote `status='accepted'`, granting a membership
    // for a revoked invite. Post-fix the transaction re-reads the invite
    // with `FOR UPDATE` and bails when it's no longer pending.
    //
    // We trigger the race by spying on `db.transaction`: just before the
    // production callback runs, we update the invite to `revoked` via a
    // direct DB call (the outer pre-tx read has already happened, the
    // inner FOR UPDATE has not). The route should respond 410
    // invite_revoked and never insert a membership.
    it('Path A race: invite revoked between outer read and transaction → 410 invite_revoked, no membership inserted', async () => {
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

      // Intercept the transaction to flip the invite to revoked between
      // the outer read (which saw status='pending') and the transaction
      // body's inner FOR UPDATE re-read. This reproduces the race the
      // round-8 P2 fix addresses.
      //
      // /auth/verify uses two transactions in sequence: first inside
      // `upsertUser` (writes the users row), then the invite-accept
      // transaction. We only revoke before the SECOND call so the user
      // upsert proceeds normally.
      const original = dbMod.db.transaction.bind(dbMod.db);
      let txCallCount = 0;
      const spy = vi
        .spyOn(dbMod.db, 'transaction')
        .mockImplementation(async (cb: Parameters<typeof original>[0]) => {
          txCallCount += 1;
          if (txCallCount === 2) {
            await dbMod.db
              .update(dbMod.schema.workspaceInvites)
              .set({ status: 'revoked' })
              .where(eq(dbMod.schema.workspaceInvites.id, invite.id));
          }
          return original(cb);
        });

      try {
        const res = await request(buildApp())
          .post('/auth/verify')
          .set('User-Agent', 'auth-route-test')
          .send({ tokenHash: 'xyz', type: 'invite', inviteId: invite.id });

        expect(res.status).toBe(410);
        expect(res.body.error).toBe('invite_revoked');
      } finally {
        spy.mockRestore();
      }

      // No membership row added for the invitee — only the inviter's
      // seeded owner membership exists.
      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([expect.objectContaining({ userId: inviter.id, role: 'owner' })]);

      // Invite remains revoked. The route's transaction must NOT have
      // overwritten status back to 'accepted'.
      const [finalInvite] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaceInvites)
        .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
        .limit(1);
      expect(finalInvite?.status).toBe('revoked');

      // Track the upsertUser-created user for cleanup.
      const [invitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, inviteeEmail))
        .limit(1);
      if (invitee) userIds.push(invitee.id);
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
      expect(res.body.redirectTo).toBe('/');

      // Already-accepted invites are idempotent — only the inviter's seeded
      // owner membership exists; no second insert for the invitee.
      const memberships = await dbMod.db
        .select()
        .from(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, ws.id));
      expect(memberships).toEqual([expect.objectContaining({ userId: inviter.id, role: 'owner' })]);

      const [invitee] = await dbMod.db
        .select()
        .from(dbMod.schema.users)
        .where(eq(dbMod.schema.users.email, inviteeEmail))
        .limit(1);
      if (invitee) userIds.push(invitee.id);
    });
  });

  describe('POST /auth/signin - cloud beta gate', () => {
    beforeEach(() => {
      mod.__resetSigninAttempts();
      process.env.OPEN42_EDITION = 'cloud';
      process.env.OPEN42_ENABLE_OPEN_SIGNUPS = 'false';
      process.env.OPEN42_ALLOWED_EMAILS = '';
      process.env.OPEN42_ALLOWED_EMAIL_DOMAINS = '';
      mocks.sendSupabaseMagicLink.mockResolvedValue({
        email: 'allowed@example.com',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    });

    afterEach(() => {
      mod.__resetSigninAttempts();
    });

    it('rejects an unknown, non-allowlisted cloud signup', async () => {
      const res = await request(buildApp())
        .post('/auth/signin')
        .set('User-Agent', 'cloud-signup-gate-test')
        .send({ email: `unknown-${Date.now()}-${Math.random()}@open42.test` });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'signin_not_allowed' });
      expect(mocks.sendSupabaseMagicLink).not.toHaveBeenCalled();
    });

    it('allows signin for a pending invitee even when open owner signups are closed', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const inviter = await seedUser(`auth-signin-inviter-${tag}@open42.test`, `sb-owner-${tag}`);
      const ws = await seedWorkspace(inviter.id, 'Inviter ws');
      const inviteeEmail = `auth-signin-invitee-${tag}@open42.test`;
      await seedInvite({
        workspaceId: ws.id,
        email: inviteeEmail,
        invitedByUserId: inviter.id,
      });

      const res = await request(buildApp())
        .post('/auth/signin')
        .set('User-Agent', 'cloud-signup-gate-test')
        .send({ email: inviteeEmail });

      expect(res.status).toBe(200);
      expect(mocks.sendSupabaseMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({ email: inviteeEmail }),
      );
    });

    it('allows signin for an accepted workspace member when open owner signups are closed', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const member = await seedUser(`auth-signin-member-${tag}@open42.test`, `sb-member-${tag}`);
      await seedWorkspace(member.id, 'Member ws');

      const res = await request(buildApp())
        .post('/auth/signin')
        .set('User-Agent', 'cloud-signup-gate-test')
        .send({ email: member.email });

      expect(res.status).toBe(200);
      expect(mocks.sendSupabaseMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({ email: member.email }),
      );
    });
  });

  describe('POST /auth/signin rate limiting', () => {
    beforeEach(() => {
      mod.__resetSigninAttempts();
      mocks.sendSupabaseMagicLink.mockResolvedValue({
        email: 'a@x.com',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      mod.__resetSigninAttempts();
    });

    it('rejects second call within 30s with 429', async () => {
      vi.useFakeTimers({ now: new Date('2026-05-08T10:00:00Z') });
      const app = buildApp();

      const r1 = await request(app)
        .post('/auth/signin')
        .set('User-Agent', 'rate-limit-test')
        .send({ email: 'a@x.com' });
      expect(r1.status).toBe(200);

      vi.advanceTimersByTime(15_000);

      const r2 = await request(app)
        .post('/auth/signin')
        .set('User-Agent', 'rate-limit-test')
        .send({ email: 'a@x.com' });
      expect(r2.status).toBe(429);
      expect(r2.headers['retry-after']).toBeDefined();
      expect(r2.body.error).toBe('signin_rate_limited');
    });

    it('allows second call after 30s', async () => {
      vi.useFakeTimers({ now: new Date('2026-05-08T10:00:00Z') });
      const app = buildApp();

      const r1 = await request(app)
        .post('/auth/signin')
        .set('User-Agent', 'rate-limit-test')
        .send({ email: 'a@x.com' });
      expect(r1.status).toBe(200);

      vi.advanceTimersByTime(31_000);

      const r2 = await request(app)
        .post('/auth/signin')
        .set('User-Agent', 'rate-limit-test')
        .send({ email: 'a@x.com' });
      expect(r2.status).toBe(200);
    });

    it('still enforces 5/15min ceiling', async () => {
      vi.useFakeTimers({ now: new Date('2026-05-08T10:00:00Z') });
      const app = buildApp();

      for (let i = 0; i < 5; i++) {
        const r = await request(app)
          .post('/auth/signin')
          .set('User-Agent', 'rate-limit-test')
          .send({ email: 'a@x.com' });
        expect(r.status).toBe(200);
        vi.advanceTimersByTime(31_000);
      }

      const r = await request(app)
        .post('/auth/signin')
        .set('User-Agent', 'rate-limit-test')
        .send({ email: 'a@x.com' });
      expect(r.status).toBe(429);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 when no session', async () => {
      const res = await request(buildApp()).get('/auth/me').set('User-Agent', 'me-route-test');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('returns { id, email, currentWorkspaceId } when session valid', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const email = `auth-me-${tag}@open42.test`;
      const user = await seedUser(email, `sb_user_${tag}`);
      const ws = await seedWorkspace(user.id, 'User workspace');

      // Update user's currentWorkspaceId to the created workspace
      await dbMod.db
        .update(dbMod.schema.users)
        .set({ currentWorkspaceId: ws.id })
        .where(eq(dbMod.schema.users.id, user.id));

      mocks.verifySupabaseIdentity.mockResolvedValue({
        supabaseUserId: `sb_user_${tag}`,
        email,
      });

      const app = buildApp();

      // First, create a session via /auth/verify
      const verifyRes = await request(app)
        .post('/auth/verify')
        .set('User-Agent', 'me-route-test')
        .send({ accessToken: 'jwt' });

      expect(verifyRes.status).toBe(200);
      const sessionCookie = verifyRes.headers['set-cookie']?.[0];
      expect(sessionCookie).toBeDefined();

      // Now call GET /auth/me with the session cookie
      const meRes = await request(app)
        .get('/auth/me')
        .set('User-Agent', 'me-route-test')
        .set('Cookie', sessionCookie ?? '');

      expect(meRes.status).toBe(200);
      expect(meRes.body).toEqual({
        id: user.id,
        email,
        currentWorkspaceId: ws.id,
      });
    });
  });
});
