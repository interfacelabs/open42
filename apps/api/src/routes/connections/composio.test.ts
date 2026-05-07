import express from 'express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createFakeComposio } from '../../composio/fake.js';
import { signState } from '../../connections/state-hmac.js';

process.env.OPEN42_INGEST_HMAC_SECRET = process.env.OPEN42_INGEST_HMAC_SECRET || 'test-hmac-secret';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('Composio connection routes', () => {
  let mod: typeof import('./composio.js');
  let dbMod: typeof import('../../db/client.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./composio.js');
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

  it('exports a router builder for OAuth init/callback', () => {
    expect(typeof mod.buildComposioRouter).toBe('function');
  });

  it.todo('returns 401 when POST /init has no session');
  it.todo('returns 403 when caller is not workspace owner');
  it.todo('returns 409 when a Notion connection already exists');
  it.todo('inserts connection_init_states and returns redirect_url on init');
  it('rejects callback with bad HMAC state', async () => {
    const app = express();
    app.use('/connections', mod.buildComposioRouter({ composio: createFakeComposio() }));

    const res = await request(app).get(
      '/connections/composio/callback?state=not-a-valid-state&connected_account_id=acc-1',
    );

    expect(res.status).toBe(400);
    expect(res.text).toBe('invalid state');
  });

  it('rejects callback connected_account_id mismatch', async () => {
    const { userId, workspaceId } = await makeWorkspace();
    const state = signState(process.env.OPEN42_INGEST_HMAC_SECRET!, {
      workspaceId,
      userId,
      nonce: 'nonce',
      expiresAt: Date.now() + 60_000,
    });
    await dbMod.db.insert(dbMod.schema.connectionInitStates).values({
      state,
      workspaceId,
      userId,
      kind: 'notion-composio',
      composioPendingId: 'pending-expected',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const app = express();
    app.use('/connections', mod.buildComposioRouter({ composio: createFakeComposio() }));

    const res = await request(app).get(
      `/connections/composio/callback?state=${encodeURIComponent(
        state,
      )}&connected_account_id=pending-actual`,
    );

    expect(res.status).toBe(400);
    expect(res.text).toBe('connected_account_id mismatch');

    const rows = await dbMod.db
      .select()
      .from(dbMod.schema.connectionInitStates)
      .where(eq(dbMod.schema.connectionInitStates.state, state));
    expect(rows).toHaveLength(0);
  });
  it.todo('creates a connection and kicks ingest on successful callback');

  async function makeWorkspace(): Promise<{ userId: string; workspaceId: string }> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `composio-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({ ownerUserId: user.id, gbrainVersion: 'test-0.0.0' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceIds.push(workspace.id);

    return { userId: user.id, workspaceId: workspace.id };
  }
});
