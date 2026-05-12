import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../../env.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

/**
 * DB-integration tests for `currentWorkspaceForUser` (the helper behind
 * `GET /workspaces/current`).
 *
 * Codex round-2 P1: `currentWorkspaceForUser` MUST honor
 * `users.current_workspace_id` when that column points at a workspace the
 * user has a membership in. If the hint is stale, fall back to "first owned,
 * then first joined" AND self-heal the column.
 *
 * The previous mock-based test (one fixed select chain) couldn't express the
 * two-query + self-heal-update flow, so this file uses the real Postgres
 * connection the way `accept.db.test.ts` does.
 */
describeDb('currentWorkspaceForUser (membership-aware lookup)', () => {
  let provisionMod: typeof import('./provision.js');
  let dbMod: typeof import('../../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    provisionMod = await import('./provision.js');
    dbMod = await import('../../db/client.js');
  });

  afterEach(async () => {
    // memberships first (FK to users + workspaces).
    for (const userId of userIds) {
      await dbMod.db
        .delete(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.userId, userId));
    }
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
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

  async function seedWorkspace(ownerUserId: string, name: string) {
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
    return ws;
  }

  async function addMembership(
    userId: string,
    workspaceId: string,
    role: 'owner' | 'admin' | 'member',
  ) {
    await dbMod.db
      .insert(dbMod.schema.memberships)
      .values({ userId, workspaceId, role })
      .onConflictDoNothing();
  }

  async function setCurrentWorkspaceId(userId: string, workspaceId: string | null) {
    await dbMod.db
      .update(dbMod.schema.users)
      .set({ currentWorkspaceId: workspaceId })
      .where(eq(dbMod.schema.users.id, userId));
  }

  async function readCurrentWorkspaceId(userId: string) {
    const [row] = await dbMod.db
      .select({ currentWorkspaceId: dbMod.schema.users.currentWorkspaceId })
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, userId))
      .limit(1);
    return row?.currentWorkspaceId ?? null;
  }

  it('uses current_workspace_id when it points at a workspace the user is a member of', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const owner = await seedUser(`cw-owner-${tag}@open42.test`);
    const member = await seedUser(`cw-member-${tag}@open42.test`);
    const wsA = await seedWorkspace(owner.id, 'Workspace A');
    const wsB = await seedWorkspace(owner.id, 'Workspace B');
    await addMembership(member.id, wsA.id, 'member');
    await addMembership(member.id, wsB.id, 'member');
    // Hint points at wsB.
    await setCurrentWorkspaceId(member.id, wsB.id);

    const ws = await provisionMod.currentWorkspaceForUser(member.id);
    expect(ws?.id).toBe(wsB.id);
    // Hint untouched.
    expect(await readCurrentWorkspaceId(member.id)).toBe(wsB.id);
  });

  it('falls back to first owned when current_workspace_id is null', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const user = await seedUser(`cw-null-${tag}@open42.test`);
    const owned = await seedWorkspace(user.id, 'Owned ws');
    await addMembership(user.id, owned.id, 'owner');
    // No hint.
    await setCurrentWorkspaceId(user.id, null);

    const ws = await provisionMod.currentWorkspaceForUser(user.id);
    expect(ws?.id).toBe(owned.id);
    // The fallback path self-heals to the picked workspace.
    expect(await readCurrentWorkspaceId(user.id)).toBe(owned.id);
  });

  it('falls back when current_workspace_id points at a workspace the user is no longer a member of, and self-heals the column', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const owner = await seedUser(`cw-self-owner-${tag}@open42.test`);
    const kickedUser = await seedUser(`cw-self-kicked-${tag}@open42.test`);
    const wsA = await seedWorkspace(owner.id, 'WS A');
    const wsB = await seedWorkspace(owner.id, 'WS B');
    // kickedUser owns wsA (so the fallback has something to find).
    await addMembership(kickedUser.id, wsA.id, 'owner');
    // Hint points at wsB, but kickedUser has NO membership in wsB.
    await setCurrentWorkspaceId(kickedUser.id, wsB.id);

    const ws = await provisionMod.currentWorkspaceForUser(kickedUser.id);
    expect(ws?.id).toBe(wsA.id);
    // Self-heal: hint now points at wsA.
    expect(await readCurrentWorkspaceId(kickedUser.id)).toBe(wsA.id);
  });

  it('returns null and writes nothing when the user has no memberships', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const orphan = await seedUser(`cw-orphan-${tag}@open42.test`);
    await setCurrentWorkspaceId(orphan.id, null);

    const ws = await provisionMod.currentWorkspaceForUser(orphan.id);
    expect(ws).toBeNull();
    expect(await readCurrentWorkspaceId(orphan.id)).toBeNull();
  });

  it('ignores soft-deleted workspaces in both the hint and the fallback', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const owner = await seedUser(`cw-soft-${tag}@open42.test`);
    const ws = await seedWorkspace(owner.id, 'Will be deleted');
    await addMembership(owner.id, ws.id, 'owner');
    await setCurrentWorkspaceId(owner.id, ws.id);
    // Soft-delete the workspace.
    await dbMod.db
      .update(dbMod.schema.workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(dbMod.schema.workspaces.id, ws.id));

    const got = await provisionMod.currentWorkspaceForUser(owner.id);
    expect(got).toBeNull();
  });

  it('prefers an owned workspace over a joined one in the fallback', async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const owner = await seedUser(`cw-fb-owner-${tag}@open42.test`);
    const user = await seedUser(`cw-fb-user-${tag}@open42.test`);
    const joined = await seedWorkspace(owner.id, 'Joined ws');
    const owned = await seedWorkspace(user.id, 'Owned ws');
    await addMembership(user.id, joined.id, 'member');
    await addMembership(user.id, owned.id, 'owner');
    await setCurrentWorkspaceId(user.id, null);

    const ws = await provisionMod.currentWorkspaceForUser(user.id);
    expect(ws?.id).toBe(owned.id);
    // Make sure the unused `joined` reference is exercised — keeps lint happy
    // and documents that joined exists in the dataset.
    expect(joined.id).not.toBe(owned.id);

    // Confirm membership relationships are intact for cleanup ordering.
    const memberships = await dbMod.db
      .select({ workspaceId: dbMod.schema.memberships.workspaceId })
      .from(dbMod.schema.memberships)
      .where(eq(dbMod.schema.memberships.userId, user.id));
    expect(memberships.map((m) => m.workspaceId).sort()).toEqual([joined.id, owned.id].sort());
  });
});
