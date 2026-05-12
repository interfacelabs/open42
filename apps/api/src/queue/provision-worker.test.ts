/**
 * Unit coverage for the provision-worker module — focused on the legacy-job
 * backward-compat path (codex round-5 P1).
 *
 * BullMQ jobs are persisted in Redis. When a new worker rolls out, jobs
 * enqueued by the *previous* worker only carry `{ ownerUserId }` — no
 * `workspaceId`. Without the fallback the worker would call
 * `provisionTenant({ workspaceId: undefined, ... })` and silently strand
 * the workspace. These tests prove the helper + the wrapper close that gap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db client + provisionTenant before importing the worker, so the
// worker's top-level imports get the mocked symbols. We hoist the mocks via
// vi.hoisted so the test can refer to them.
const mocks = vi.hoisted(() => {
  const dbRows: { rows: Array<{ id: string }> } = { rows: [] };
  return { dbRows };
});

vi.mock('../db/client.js', () => {
  // Drizzle's query builder is fluent. We only care about the final
  // `limit()` — that returns the promise. Each link returns the same
  // chain object so any call order works.
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => mocks.dbRows.rows,
  };
  return {
    db: {
      select: () => chain,
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
    schema: {
      workspaces: {
        id: 'id',
        ownerUserId: 'owner_user_id',
        status: 'status',
        deletedAt: 'deleted_at',
        createdAt: 'created_at',
      },
    },
  };
});

vi.mock('../tenants/provision.js', () => ({
  provisionTenant: vi.fn(async () => undefined),
  classifyProvisioningError: vi.fn(() => 'unknown'),
}));

vi.mock('./connection.js', () => ({
  buildBullSubscriber: () => ({}),
  buildBullClient: () => ({}),
}));

// Import AFTER the mocks are registered so the worker sees them.
const {
  processProvisionJob,
  resolveLegacyProvisioningWorkspaceId,
} = await import('./provision-worker.js');
const { provisionTenant } = await import('../tenants/provision.js');

function makeJob(data: { workspaceId?: string; ownerUserId: string; manualRetry?: boolean }) {
  return {
    id: 'job-1',
    data,
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as any;
}

describe('resolveLegacyProvisioningWorkspaceId', () => {
  beforeEach(() => {
    mocks.dbRows.rows = [];
  });

  it('returns the workspace id when a provisioning row exists', async () => {
    mocks.dbRows.rows = [{ id: 'ws-legacy' }];
    const id = await resolveLegacyProvisioningWorkspaceId('owner-1');
    expect(id).toBe('ws-legacy');
  });

  it('returns null when the owner has no provisioning workspace', async () => {
    mocks.dbRows.rows = [];
    const id = await resolveLegacyProvisioningWorkspaceId('owner-1');
    expect(id).toBeNull();
  });
});

describe('processProvisionJob — legacy job backward-compat', () => {
  beforeEach(() => {
    mocks.dbRows.rows = [];
    (provisionTenant as any).mockClear();
  });

  it('resolves workspaceId via the legacy helper when job.data lacks it', async () => {
    mocks.dbRows.rows = [{ id: 'ws-legacy' }];
    await processProvisionJob(makeJob({ ownerUserId: 'owner-1' }));
    expect(provisionTenant).toHaveBeenCalledWith({
      workspaceId: 'ws-legacy',
      ownerUserId: 'owner-1',
    });
  });

  it('uses job.data.workspaceId directly when present (no lookup needed)', async () => {
    // dbRows is empty — if the worker fell through to the helper this would
    // bail out, so successful invocation of provisionTenant with ws-direct
    // proves the new path skipped the helper.
    await processProvisionJob(
      makeJob({ workspaceId: 'ws-direct', ownerUserId: 'owner-1' }),
    );
    expect(provisionTenant).toHaveBeenCalledWith({
      workspaceId: 'ws-direct',
      ownerUserId: 'owner-1',
    });
  });

  it('bails out without calling provisionTenant when no workspace can be resolved', async () => {
    mocks.dbRows.rows = [];
    await processProvisionJob(makeJob({ ownerUserId: 'owner-orphan' }));
    expect(provisionTenant).not.toHaveBeenCalled();
  });
});
