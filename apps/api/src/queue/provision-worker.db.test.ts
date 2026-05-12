/**
 * DB-integration tests for the SQL paths inside `provision-worker.ts`.
 *
 * The pure-unit tests in `provision-worker.test.ts` stub the Drizzle client
 * wholesale — they prove the legacy-job backward-compat path resolves the
 * right workspace id, but they don't exercise the actual SQL the helpers run
 * against Postgres. This file follows the `describeDb` pattern from
 * `apps/api/src/routes/workspaces/accept.db.test.ts`: it only runs when
 * DATABASE_URL is set (CI integration job + local dev), and is skipped
 * otherwise so the standard `npm test` stays hermetic.
 *
 * Coverage:
 *   - resetWorkspaceProvisioningRow: clears last_error, resets the attempt
 *     counter to 0, and advances provisioning_started_at to "now".
 *   - markWorkspaceFailed: flips status='failed' and persists the classified
 *     error code.
 *   - resolveLegacyProvisioningWorkspaceId: returns the most-recent
 *     provisioning workspace for an owner (backward-compat for jobs
 *     enqueued by the pre-workspaceId worker), or null when none qualifies.
 *
 * We mock BullMQ + the Redis connection helpers at the import layer so
 * importing `provision-worker.ts` doesn't try to dial Redis. The DB calls
 * themselves hit real Postgres.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import '../env.js';

// Mock BullMQ + the Redis connection so the worker module imports cleanly
// without trying to dial Redis. The DB helpers we test do NOT touch BullMQ.
vi.mock('bullmq', () => ({
  Worker: class {
    on() {}
    async close() {}
  },
}));
vi.mock('./connection.js', () => ({
  buildBullSubscriber: () => ({}),
  buildBullClient: () => ({}),
}));

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('provision-worker SQL paths (DB integration)', () => {
  let workerMod: typeof import('./provision-worker.js');
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    workerMod = await import('./provision-worker.js');
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

  async function seedWorkspace(
    ownerUserId: string,
    overrides: Partial<typeof dbMod.schema.workspaces.$inferInsert> = {},
  ) {
    const [ws] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId,
        name: 'Provision DB test ws',
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: 'provisioning',
        ...overrides,
      })
      .returning();
    if (!ws) throw new Error('seedWorkspace failed');
    workspaceIds.push(ws.id);
    return ws;
  }

  describe('resetWorkspaceProvisioningRow', () => {
    it('clears lastError, zeroes provisionAttempts, and bumps provisioningStartedAt to "now"', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const owner = await seedUser(`pw-reset-${tag}@open42.test`);
      const oldStart = new Date('2026-01-01T00:00:00Z');
      const ws = await seedWorkspace(owner.id, {
        status: 'provisioning',
        provisioningStartedAt: oldStart,
        provisionAttempts: 3,
        lastError: 'timeout',
      });

      const before = Date.now();
      await workerMod.resetWorkspaceProvisioningRow(ws.id);

      const [refreshed] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, ws.id))
        .limit(1);
      expect(refreshed?.status).toBe('provisioning');
      expect(refreshed?.lastError).toBeNull();
      expect(refreshed?.provisionAttempts).toBe(0);
      // provisioningStartedAt was '2026-01-01'; it should now be > the
      // snapshot we took just before the call.
      expect(refreshed?.provisioningStartedAt).toBeInstanceOf(Date);
      expect(refreshed!.provisioningStartedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(refreshed!.provisioningStartedAt.getTime()).toBeGreaterThan(
        oldStart.getTime(),
      );
    });
  });

  describe('markWorkspaceFailed', () => {
    it('flips status to "failed" and persists the classified error code', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const owner = await seedUser(`pw-failed-${tag}@open42.test`);
      const ws = await seedWorkspace(owner.id, {
        status: 'provisioning',
        lastError: null,
      });

      await workerMod.markWorkspaceFailed(ws.id, 'docker_pull_failed');

      const [refreshed] = await dbMod.db
        .select()
        .from(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, ws.id))
        .limit(1);
      expect(refreshed?.status).toBe('failed');
      expect(refreshed?.lastError).toBe('docker_pull_failed');
    });
  });

  describe('resolveLegacyProvisioningWorkspaceId', () => {
    it('returns the most-recent provisioning workspace for the owner (ignores ready + failed)', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const owner = await seedUser(`pw-legacy-${tag}@open42.test`);
      // Seed three workspaces with explicit, ordered createdAt timestamps so
      // the "most-recent" assertion is deterministic regardless of insert
      // wall-clock skew. The provisioning row is the newest.
      await seedWorkspace(owner.id, {
        status: 'ready',
        createdAt: new Date(Date.now() - 60_000),
      });
      const provisioning = await seedWorkspace(owner.id, {
        status: 'provisioning',
        createdAt: new Date(Date.now()),
      });
      await seedWorkspace(owner.id, {
        status: 'failed',
        createdAt: new Date(Date.now() - 30_000),
        lastError: 'older_failure',
      });

      const id = await workerMod.resolveLegacyProvisioningWorkspaceId(owner.id);
      expect(id).toBe(provisioning.id);
    });

    it('returns null when the owner has no provisioning workspaces', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const owner = await seedUser(`pw-legacy-none-${tag}@open42.test`);
      await seedWorkspace(owner.id, { status: 'ready' });
      await seedWorkspace(owner.id, { status: 'failed', lastError: 'x' });

      const id = await workerMod.resolveLegacyProvisioningWorkspaceId(owner.id);
      expect(id).toBeNull();
    });

    it('ignores soft-deleted provisioning workspaces', async () => {
      const tag = `${Date.now()}-${Math.random()}`;
      const owner = await seedUser(`pw-legacy-deleted-${tag}@open42.test`);
      await seedWorkspace(owner.id, {
        status: 'provisioning',
        deletedAt: new Date(),
      });

      const id = await workerMod.resolveLegacyProvisioningWorkspaceId(owner.id);
      expect(id).toBeNull();
    });
  });
});
