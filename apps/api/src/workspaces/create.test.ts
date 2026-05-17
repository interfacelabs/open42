import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../env.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('createWorkspaceForUser', () => {
  let createMod: typeof import('./create.js');
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    createMod = await import('./create.js');
    dbMod = await import('../db/client.js');
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, workspaceId));
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      // Wipe current_workspace_id first — it may still reference a workspace
      // we already deleted in another test's afterEach window if seeding
      // races collide.
      await dbMod.db
        .update(dbMod.schema.users)
        .set({ currentWorkspaceId: null })
        .where(eq(dbMod.schema.users.id, userId));
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  async function seedUser(email: string) {
    const [user] = await dbMod.db.insert(dbMod.schema.users).values({ email }).returning();
    if (!user) throw new Error('seedUser failed');
    userIds.push(user.id);
    return user;
  }

  function openOwnerSignupEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      OPEN42_EDITION: 'cloud',
      OPEN42_ENABLE_OPEN_SIGNUPS: 'true',
      OPEN42_ALLOWED_EMAILS: '',
      OPEN42_ALLOWED_EMAIL_DOMAINS: '',
    };
  }

  it('inserts workspace + owner membership, sets current_workspace_id when NULL, enqueues once', async () => {
    const user = await seedUser(`create-happy-${Date.now()}-${Math.random()}@open42.test`);
    const enqueue = vi.fn(async (data: { workspaceId: string; ownerUserId: string }) => ({
      jobId: data.workspaceId,
      alreadyEnqueued: false,
    }));

    const result = await createMod.createWorkspaceForUser(user.id, 'Acme', {
      enqueueProvisionJob: enqueue as never,
      env: openOwnerSignupEnv(),
    });
    workspaceIds.push(result.id);

    expect(result.name).toBe('Acme');
    expect(result.status).toBe('provisioning');

    // Workspace row exists with the expected fields.
    const [ws] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaces)
      .where(eq(dbMod.schema.workspaces.id, result.id))
      .limit(1);
    expect(ws).toBeDefined();
    expect(ws?.ownerUserId).toBe(user.id);
    expect(ws?.status).toBe('provisioning');

    // Owner membership row exists.
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(eq(dbMod.schema.memberships.workspaceId, result.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(user.id);
    expect(memberships[0]?.role).toBe('owner');

    // users.current_workspace_id was NULL at start, so it must now point at
    // the freshly created workspace.
    const [updatedUser] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(updatedUser?.currentWorkspaceId).toBe(result.id);

    // Enqueue called exactly once with the new workspaceId + ownerUserId.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      workspaceId: result.id,
      ownerUserId: user.id,
    });
  });

  it('does NOT overwrite a non-null users.current_workspace_id (UI hint NULL-guard)', async () => {
    const user = await seedUser(`create-guard-${Date.now()}-${Math.random()}@open42.test`);

    // First create — sets current_workspace_id from NULL → ws1.
    const enqueue1 = vi.fn(async () => ({ jobId: 'ignored', alreadyEnqueued: false }));
    const ws1 = await createMod.createWorkspaceForUser(user.id, 'First', {
      enqueueProvisionJob: enqueue1 as never,
      env: openOwnerSignupEnv(),
    });
    workspaceIds.push(ws1.id);

    // Sanity: current_workspace_id is ws1.id now.
    const [afterFirst] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(afterFirst?.currentWorkspaceId).toBe(ws1.id);

    // Second create — must NOT overwrite (user is "actively working in" ws1).
    const enqueue2 = vi.fn(async () => ({ jobId: 'ignored', alreadyEnqueued: false }));
    const ws2 = await createMod.createWorkspaceForUser(user.id, 'Second', {
      enqueueProvisionJob: enqueue2 as never,
      env: openOwnerSignupEnv(),
    });
    workspaceIds.push(ws2.id);

    const [afterSecond] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(afterSecond?.currentWorkspaceId).toBe(ws1.id);
    expect(afterSecond?.currentWorkspaceId).not.toBe(ws2.id);

    // And the second workspace + its owner membership still exist —
    // current_workspace_id is purely a UI hint, not a gate.
    const memberships = await dbMod.db
      .select()
      .from(dbMod.schema.memberships)
      .where(eq(dbMod.schema.memberships.workspaceId, ws2.id));
    expect(memberships).toHaveLength(1);
  });

  it('rejects cloud owner workspace creation when the email is not authorized', async () => {
    const user = await seedUser(`create-blocked-${Date.now()}-${Math.random()}@open42.test`);
    const enqueue = vi.fn(async () => ({ jobId: 'ignored', alreadyEnqueued: false }));

    await expect(
      createMod.createWorkspaceForUser(user.id, 'Blocked', {
        enqueueProvisionJob: enqueue as never,
        env: {
          ...process.env,
          OPEN42_EDITION: 'cloud',
          OPEN42_ENABLE_OPEN_SIGNUPS: 'false',
          OPEN42_ALLOWED_EMAILS: 'someone-else@open42.test',
          OPEN42_ALLOWED_EMAIL_DOMAINS: '',
        },
      }),
    ).rejects.toThrow('owner_signup_not_allowed');

    const workspaces = await dbMod.db
      .select()
      .from(dbMod.schema.workspaces)
      .where(eq(dbMod.schema.workspaces.ownerUserId, user.id));
    expect(workspaces).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
