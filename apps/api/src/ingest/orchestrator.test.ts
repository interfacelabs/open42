import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { ComposioClient } from '../composio/client.js';
import type { Connector, ExtractOptions, ExtractResult, NormalizedDoc } from '../connectors/interface.js';
import type { GbrainClient } from '../gbrain/client.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('runWorkspaceCycle', () => {
  let mod: typeof import('./orchestrator.js');
  let dbMod: typeof import('../db/client.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./orchestrator.js');
    dbMod = await import('../db/client.js');
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.workspaces).where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  it('exports the cycle runner and scheduler surface', () => {
    expect(typeof mod.runWorkspaceCycle).toBe('function');
    expect(typeof mod.startScheduler).toBe('function');
  });

  it('advances cursor and marks pollable connections active after successful delivery', async () => {
    const workspaceId = await makeWorkspace();
    const [connection] = await dbMod.db
      .insert(dbMod.schema.connections)
      .values({
        workspaceId,
        kind: 'notion-composio',
        status: 'pending_import',
        displayName: 'Notion Live',
        composioConnectedAccountId: 'acc-success',
        cursor: {},
      })
      .returning();
    if (!connection) throw new Error('connection insert failed');

    const submittedJobs: Array<{ name: string; params: Record<string, unknown> }> = [];
    const result = await mod.runWorkspaceCycle(
      {
        composio: composioForWorkspace(workspaceId),
        gbrain: async () =>
          ({
            submitJob: async (name: string, params: Record<string, unknown>) => {
              submittedJobs.push({ name, params });
              return { id: 'gb-1' };
            },
            getJobProgress: async () => ({ status: 'completed' }),
          }) as unknown as GbrainClient,
        resolveConnector: () =>
          pollableConnector([
            {
              slug: 'handbook',
              title: 'Handbook',
              content_md: '# Handbook',
              metadata: { source_ref: 'test:handbook' },
            },
          ]),
        heartbeatIntervalMs: 60_000,
      },
      workspaceId,
    );

    expect(result.status).toBe('completed');
    expect(result.pagesTotal).toBe(1);
    expect(submittedJobs).toHaveLength(1);
    expect(submittedJobs[0]).toMatchObject({ name: 'import' });

    const [updated] = await dbMod.db
      .select()
      .from(dbMod.schema.connections)
      .where(eq(dbMod.schema.connections.id, connection.id));
    expect(updated?.status).toBe('active');
    expect(updated?.cursor).toEqual({ since_iso: '2026-05-06T12:00:00.000Z' });
    expect(updated?.lastPulledAt).toBeInstanceOf(Date);

    const [job] = await dbMod.db
      .select()
      .from(dbMod.schema.ingestJobs)
      .where(eq(dbMod.schema.ingestJobs.id, result.jobId));
    expect(job?.status).toBe('completed');
    expect(job?.pagesTotal).toBe(1);
  });
  it.todo('records connector failure while allowing other connectors to succeed');
  it.todo('advances zero-doc successful connectors without submitting to gbrain');
  it.todo('marks one-shot notion-zip connections completed and deletes their zip file');
  it.todo('does not advance cursors when gbrain submit or poll fails');
  it('aborts without commits when heartbeat loses the workspace lock', async () => {
    const workspaceId = await makeWorkspace();
    const [connection] = await dbMod.db
      .insert(dbMod.schema.connections)
      .values({
        workspaceId,
        kind: 'notion-composio',
        status: 'pending_import',
        displayName: 'Notion Live',
        composioConnectedAccountId: 'acc-lock-lost',
        cursor: {},
      })
      .returning();
    if (!connection) throw new Error('connection insert failed');

    let submitCount = 0;
    const result = await mod.runWorkspaceCycle(
      {
        composio: composioForWorkspace(workspaceId),
        gbrain: async () =>
          ({
            submitJob: async () => {
              submitCount += 1;
              return { id: 'gb-lost' };
            },
            getJobProgress: async () => ({ status: 'completed' }),
          }) as unknown as GbrainClient,
        resolveConnector: () => lockLosingConnector(workspaceId),
        heartbeatIntervalMs: 5,
      },
      workspaceId,
    );

    expect(result.status).toBe('aborted_lock_lost');
    expect(submitCount).toBe(0);

    const [updated] = await dbMod.db
      .select()
      .from(dbMod.schema.connections)
      .where(eq(dbMod.schema.connections.id, connection.id));
    expect(updated?.status).toBe('pending_import');
    expect(updated?.cursor).toEqual({});
    expect(updated?.lastPulledAt).toBeNull();

    const [job] = await dbMod.db
      .select()
      .from(dbMod.schema.ingestJobs)
      .where(eq(dbMod.schema.ingestJobs.id, result.jobId));
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('ingest lock lost');
  });
  it.todo('moves Composio workspace mismatches to errored before extraction');
  it.todo('skips Composio integrity checks for notion-zip connections');
  it.todo('writes a completed no-op job for cycles with no eligible connections');

  async function makeWorkspace(): Promise<string> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `orchestrator-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({ ownerUserId: user.id, gbrainVersion: 'test-0.0.0' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  function composioForWorkspace(workspaceId: string): ComposioClient {
    return {
      initiateConnection: async () => {
        throw new Error('not used');
      },
      getConnection: async (id) => ({ id, status: 'ACTIVE', user_id: workspaceId, app: 'notion' }),
      deleteConnection: async () => undefined,
      executeTool: async () => {
        throw new Error('not used');
      },
    };
  }

  function pollableConnector(docs: NormalizedDoc[]): Connector {
    return {
      name: 'test-pollable',
      version: '0.0.0',
      mode: 'pollable',
      extract(): ExtractResult {
        return {
          docs: (async function* () {
            for (const doc of docs) yield doc;
          })(),
          finalize: () => ({ since_iso: '2026-05-06T12:00:00.000Z' }),
        };
      },
    };
  }

  function lockLosingConnector(workspaceId: string): Connector {
    return {
      name: 'test-lock-losing',
      version: '0.0.0',
      mode: 'pollable',
      extract(_ctx, opts?: ExtractOptions): ExtractResult {
        return {
          docs: (async function* () {
            await dbMod.db
              .update(dbMod.schema.workspaces)
              .set({ ingestLockUntil: new Date(Date.now() + 60_000) })
              .where(eq(dbMod.schema.workspaces.id, workspaceId));
            await sleep(30);
            opts?.signal?.throwIfAborted();
            yield {
              slug: 'should-not-commit',
              title: 'Should Not Commit',
              content_md: 'nope',
              metadata: { source_ref: 'test:nope' },
            };
          })(),
          finalize: () => ({ since_iso: 'should-not-commit' }),
        };
      },
    };
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
});
