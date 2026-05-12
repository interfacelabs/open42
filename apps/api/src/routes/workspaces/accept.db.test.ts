import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../env.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

/**
 * DB-integration tests for the `acceptInvite` repo transaction. These exercise
 * the real `defaultRepo()` against Postgres (same `describeDb` pattern as
 * `auth.test.ts`). The pure-unit tests in `accept.test.ts` stub the repo and
 * only cover the HTTP-mapping layer of the router — this file covers the
 * transaction's actual writes (membership row, invite status flip,
 * current_workspace_id update) and the email-mismatch / expired no-write paths.
 */
describeDb('acceptInvite repo (DB integration)', () => {
  let acceptMod: typeof import('./accept.js');
  let dbMod: typeof import('../../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const inviteIds: string[] = [];

  beforeAll(async () => {
    acceptMod = await import('./accept.js');
    dbMod = await import('../../db/client.js');
  });

  afterEach(async () => {
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

  async function seedUser(email: string) {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email })
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
    const values: typeof dbMod.schema.workspaceInvites.$inferInsert = {
      workspaceId: input.workspaceId,
      email: input.email,
      invitedByUserId: input.invitedByUserId,
      role: 'member',
      status: input.status ?? 'pending',
    };
    if (input.createdAt) values.createdAt = input.createdAt;
    const [invite] = await dbMod.db
      .insert(dbMod.schema.workspaceInvites)
      .values(values)
      .returning();
    if (!invite) throw new Error('seedInvite failed');
    inviteIds.push(invite.id);
    return invite;
  }

  it('happy path: inserts membership at invite role, marks invite accepted, sets current_workspace_id', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const inviter = await seedUser(`accept-db-inviter-${tag}@open42.test`);
    const invitee = await seedUser(`accept-db-invitee-${tag}@open42.test`);
    const ws = await seedWorkspace(inviter.id, 'Accept DB ws');
    const invite = await seedInvite({
      workspaceId: ws.id,
      email: invitee.email,
      invitedByUserId: inviter.id,
    });

    const result = await acceptMod.defaultRepo().acceptInvite(invite.id, invitee.id);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.workspace.id).toBe(ws.id);
    }

    // Membership row exists at the invite's role (member, not owner).
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(
        and(
          eq(dbMod.schema.memberships.userId, invitee.id),
          eq(dbMod.schema.memberships.workspaceId, ws.id),
        ),
      );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('member');

    // Invite row flipped to accepted.
    const [refreshedInvite] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaceInvites)
      .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
      .limit(1);
    expect(refreshedInvite?.status).toBe('accepted');

    // users.current_workspace_id updated to the workspace.
    const [refreshedUser] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, invitee.id))
      .limit(1);
    expect(refreshedUser?.currentWorkspaceId).toBe(ws.id);
  });

  it('already-member with pending invite: flips invite to accepted, no duplicate membership, updates current_workspace_id', async () => {
    // Models the "admin added the user out-of-band" / race scenario from Fix 1.
    // A membership row already exists; a `pending` invite for the same
    // (workspace, email) is left over and surfaces in admin UI. Accepting
    // should be a no-op for membership, but should flip the stale invite.
    const tag = `${Date.now()}-${Math.random()}`;
    const inviter = await seedUser(`accept-db-inviter-${tag}@open42.test`);
    const invitee = await seedUser(`accept-db-invitee-${tag}@open42.test`);
    const ws = await seedWorkspace(inviter.id, 'Already-member ws');

    // Seed pre-existing membership (out-of-band add).
    await dbMod.db
      .insert(dbMod.schema.memberships)
      .values({ userId: invitee.id, workspaceId: ws.id, role: 'member' });

    const invite = await seedInvite({
      workspaceId: ws.id,
      email: invitee.email,
      invitedByUserId: inviter.id,
      status: 'pending',
    });

    const result = await acceptMod.defaultRepo().acceptInvite(invite.id, invitee.id);
    expect(result.kind).toBe('ok');

    // Invite row flipped to accepted (Fix 1).
    const [refreshedInvite] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaceInvites)
      .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
      .limit(1);
    expect(refreshedInvite?.status).toBe('accepted');

    // Exactly one membership row — no duplicate inserted.
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(
        and(
          eq(dbMod.schema.memberships.userId, invitee.id),
          eq(dbMod.schema.memberships.workspaceId, ws.id),
        ),
      );
    expect(memberships).toHaveLength(1);

    // current_workspace_id still gets updated.
    const [refreshedUser] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, invitee.id))
      .limit(1);
    expect(refreshedUser?.currentWorkspaceId).toBe(ws.id);
  });

  it('email mismatch: returns email_mismatch with no DB writes', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const inviter = await seedUser(`accept-db-inviter-${tag}@open42.test`);
    const caller = await seedUser(`accept-db-a-${tag}@open42.test`);
    const ws = await seedWorkspace(inviter.id, 'Email-mismatch ws');
    const invite = await seedInvite({
      workspaceId: ws.id,
      email: `accept-db-b-${tag}@open42.test`,
      invitedByUserId: inviter.id,
    });

    const callerBefore = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, caller.id))
      .limit(1);

    const result = await acceptMod.defaultRepo().acceptInvite(invite.id, caller.id);
    expect(result.kind).toBe('email_mismatch');

    // No membership row inserted for the caller.
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(
        and(
          eq(dbMod.schema.memberships.userId, caller.id),
          eq(dbMod.schema.memberships.workspaceId, ws.id),
        ),
      );
    expect(memberships).toHaveLength(0);

    // Invite remains pending.
    const [refreshedInvite] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaceInvites)
      .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
      .limit(1);
    expect(refreshedInvite?.status).toBe('pending');

    // Caller's current_workspace_id unchanged.
    const [callerAfter] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, caller.id))
      .limit(1);
    expect(callerAfter?.currentWorkspaceId).toBe(callerBefore[0]?.currentWorkspaceId ?? null);
  });

  it('expired invite (created_at older than 24h): returns expired with no DB writes', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const inviter = await seedUser(`accept-db-inviter-${tag}@open42.test`);
    const invitee = await seedUser(`accept-db-invitee-${tag}@open42.test`);
    const ws = await seedWorkspace(inviter.id, 'Expired ws');
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const invite = await seedInvite({
      workspaceId: ws.id,
      email: invitee.email,
      invitedByUserId: inviter.id,
      status: 'pending',
      createdAt: twentyFiveHoursAgo,
    });

    const result = await acceptMod.defaultRepo().acceptInvite(invite.id, invitee.id);
    expect(result.kind).toBe('expired');

    // No membership row inserted.
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(
        and(
          eq(dbMod.schema.memberships.userId, invitee.id),
          eq(dbMod.schema.memberships.workspaceId, ws.id),
        ),
      );
    expect(memberships).toHaveLength(0);

    // Invite remains pending.
    const [refreshedInvite] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaceInvites)
      .where(eq(dbMod.schema.workspaceInvites.id, invite.id))
      .limit(1);
    expect(refreshedInvite?.status).toBe('pending');

    // Invitee's current_workspace_id unchanged (still null).
    const [refreshedUser] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, invitee.id))
      .limit(1);
    expect(refreshedUser?.currentWorkspaceId).toBeNull();
  });
});
