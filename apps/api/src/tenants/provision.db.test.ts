import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import '../env.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('createDrizzleTenantRepo().createWorkspace — current_workspace_id NULL-guard', () => {
  let provisionMod: typeof import('./provision.js');
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    provisionMod = await import('./provision.js');
    dbMod = await import('../db/client.js');
  });

  afterEach(async () => {
    for (const userId of userIds.slice()) {
      // Drop the FK before deleting workspaces — current_workspace_id may
      // reference a workspace we're about to delete.
      await dbMod.db
        .update(dbMod.schema.users)
        .set({ currentWorkspaceId: null })
        .where(eq(dbMod.schema.users.id, userId));
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
    await dbMod.db
      .insert(dbMod.schema.memberships)
      .values({ userId: ownerUserId, workspaceId: ws.id, role: 'owner' })
      .onConflictDoNothing();
    return ws;
  }

  it('sets current_workspace_id to the new workspace when it starts NULL (first-workspace path)', async () => {
    const user = await seedUser(`provision-first-${Date.now()}-${Math.random()}@open42.test`);
    // Sanity: NULL at start (the user-insert default).
    const [before] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(before?.currentWorkspaceId).toBeNull();

    // Seed an empty provisioning row so createWorkspace's "update existing
    // row" branch runs (mirrors production: workspaces are inserted upfront
    // by createWorkspaceForUser / saveWorkspaceName before the tenant worker
    // calls createWorkspace).
    const ws = await seedWorkspace(user.id, 'First');

    const repo = provisionMod.createDrizzleTenantRepo();
    await repo.createWorkspace({
      id: ws.id,
      ownerUserId: user.id,
      tenantRuntimeId: 'machine-first',
      gbrainPrivateAddress: '127.0.0.1:18001',
      gbrainBaseUrl: 'http://127.0.0.1:18001',
      gbrainOauthClientId: 'client-first',
      gbrainOauthClientSecretCiphertext: Buffer.from('ciphertext'),
      proxyTokenHash: Buffer.alloc(32),
      gbrainVersion: '0.31.3',
    });

    const [after] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(after?.currentWorkspaceId).toBe(ws.id);
  });

  it('does NOT overwrite current_workspace_id when it already points at another workspace (codex round-4 P2)', async () => {
    const user = await seedUser(`provision-guard-${Date.now()}-${Math.random()}@open42.test`);

    // Workspace A is the user's active workspace.
    const wsA = await seedWorkspace(user.id, 'A');
    await dbMod.db
      .update(dbMod.schema.users)
      .set({ currentWorkspaceId: wsA.id })
      .where(eq(dbMod.schema.users.id, user.id));

    // Workspace B is provisioning in the background. Seed the row first to
    // mirror the production sequence: createWorkspaceForUser inserted B
    // upfront with status='provisioning', and now the tenant worker calls
    // createWorkspace to flip B to 'ready'.
    const wsB = await seedWorkspace(user.id, 'B');

    const repo = provisionMod.createDrizzleTenantRepo();
    await repo.createWorkspace({
      id: wsB.id,
      ownerUserId: user.id,
      tenantRuntimeId: 'machine-b',
      gbrainPrivateAddress: '127.0.0.1:18002',
      gbrainBaseUrl: 'http://127.0.0.1:18002',
      gbrainOauthClientId: 'client-b',
      gbrainOauthClientSecretCiphertext: Buffer.from('ciphertext-b'),
      proxyTokenHash: Buffer.alloc(32),
      gbrainVersion: '0.31.3',
    });

    // current_workspace_id must STILL point at A — user was actively working
    // there and B becoming ready in the background must not yank them away.
    const [after] = await dbMod.db
      .select()
      .from(dbMod.schema.users)
      .where(eq(dbMod.schema.users.id, user.id))
      .limit(1);
    expect(after?.currentWorkspaceId).toBe(wsA.id);
    expect(after?.currentWorkspaceId).not.toBe(wsB.id);

    // And B's status flipped to 'ready' — current_workspace_id is purely the
    // UI hint, not a gate.
    const [wsBAfter] = await dbMod.db
      .select()
      .from(dbMod.schema.workspaces)
      .where(eq(dbMod.schema.workspaces.id, wsB.id))
      .limit(1);
    expect(wsBAfter?.status).toBe('ready');
  });
});
