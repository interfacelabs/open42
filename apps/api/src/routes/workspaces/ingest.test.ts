import express from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('workspace ingest routes', () => {
  let mod: typeof import('./ingest.js');
  let dbMod: typeof import('../../db/client.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./ingest.js');
    dbMod = await import('../../db/client.js');
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.workspaces).where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  it('exports a router builder', () => {
    expect(typeof mod.buildIngestRouter).toBe('function');
  });

  it.todo('GET returns ingest settings plus latest job');
  it.todo('PATCH validates mode and interval');
  it.todo('PATCH is owner-only');
  it('POST sync returns 409 when cycle is already locked', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace();
    await dbMod.db
      .update(dbMod.schema.workspaces)
      .set({ ingestLockUntil: new Date(Date.now() + 60_000) })
      .where(eq(dbMod.schema.workspaces.id, workspaceId));

    const runCycle = vi.fn();
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(cookieParser());
    app.use('/workspaces', mod.buildIngestRouter({ runCycle }));

    const res = await request(app)
      .post(`/workspaces/${workspaceId}/ingest/sync`)
      .set('User-Agent', 'ingest-test-agent')
      .set('X-Forwarded-For', '203.0.113.10')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'cycle_in_progress' });
    expect(runCycle).not.toHaveBeenCalled();
  });
  it.todo('POST sync creates a running job before returning 202');
  it.todo('GET jobs returns workspace job history ordered by created_at desc');

  async function makeOwnerWorkspace(): Promise<{ userId: string; workspaceId: string; sessionId: string }> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `ingest-route-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({ ownerUserId: user.id, gbrainVersion: 'test-0.0.0' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceIds.push(workspace.id);

    await dbMod.db
      .update(dbMod.schema.users)
      .set({ currentWorkspaceId: workspace.id })
      .where(eq(dbMod.schema.users.id, user.id));
    await dbMod.db.insert(dbMod.schema.memberships).values({
      userId: user.id,
      workspaceId: workspace.id,
      role: 'owner',
    });
    const [session] = await dbMod.db
      .insert(dbMod.schema.sessions)
      .values({
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        csrfToken: 'csrf',
        userAgent: 'ingest-test-agent',
        ipFirstOctet: '203',
      })
      .returning();
    if (!session) throw new Error('session insert failed');

    return { userId: user.id, workspaceId: workspace.id, sessionId: session.id };
  }
});
