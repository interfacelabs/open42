import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ResolvedComposioProfile } from '../../composio/profiles.js';

process.env.OPEN42_INGEST_HMAC_SECRET = process.env.OPEN42_INGEST_HMAC_SECRET || 'test-hmac-secret';

// Hoisted mock for the membership middleware so this unit test can drive the
// composio router without a real session+membership row in the DB. Individual
// tests override `impl` per-case (allow / deny / specific role).
const middlewareMocks = vi.hoisted(() => ({
  impl: (req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: 'ws-test', role: 'owner' };
    req.session = { id: 'sess-test', userId: 'user-test' };
    next();
  },
}));

vi.mock('../../middleware/require-membership.js', () => ({
  requireMembership: () => (req: Request, res: Response, next: NextFunction) =>
    middlewareMocks.impl(req, res, next),
}));

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
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  it('exports a router builder for OAuth init/finalize', () => {
    expect(typeof mod.buildComposioRouter).toBe('function');
  });

  it.todo('returns 401 when POST /init has no session');
  it.todo('returns 403 when caller is not workspace member');
  it.todo('returns 409 when a Notion connection already exists');
  it('persists selected BYOK profile and service through init/finalize', async () => {
    const { workspaceId, userId } = await makeReadyWorkspace();
    const profileId = await makeComposioProfile(workspaceId, userId);
    const pendingAccountId = 'acc-byok-selected';
    const resolveProfile = vi.fn(
      async (_input: {
        workspaceId: string;
        serviceId: string;
        authProfileId?: string | null;
      }): Promise<ResolvedComposioProfile> => ({
        profileId,
        mode: 'byok',
        service: {
          serviceId: 'notion',
          label: 'Notion',
          detail: 'Live pages via OAuth',
          connectionKind: 'notion-composio',
          composioToolkit: 'NOTION',
          logoSlug: 'notion',
          authConfigEnv: 'COMPOSIO_NOTION_AUTH_CONFIG_ID',
          status: 'available',
          mode: 'pollable',
          capabilities: [],
          allowedTools: [],
          extractor: 'notion-composio',
        },
        authConfigId: 'authcfg-byok',
        client: {
          initiateConnection: async () => ({
            redirect_url: `https://composio.test/callback?connectedAccountId=${pendingAccountId}`,
            pending_connected_account_id: pendingAccountId,
          }),
          getConnection: async (id) => ({
            id,
            status: 'ACTIVE',
            user_id: workspaceId,
            app: 'notion',
          }),
          deleteConnection: async () => undefined,
          executeTool: async () => {
            throw new Error('not used');
          },
        },
      }),
    );
    const app = buildApp(workspaceId, userId, { resolveProfile });

    const init = await request(app)
      .post(`/workspaces/${workspaceId}/connections/init`)
      .send({ kind: 'notion-composio', serviceId: 'notion', authProfileId: profileId })
      .expect(200);
    expect(init.body.redirect_url).toContain('composio.test');

    const [initState] = await dbMod.db
      .select()
      .from(dbMod.schema.connectionInitStates)
      .where(eq(dbMod.schema.connectionInitStates.workspaceId, workspaceId));
    const state = initState?.state;
    expect(state).toBeTruthy();
    expect(initState).toMatchObject({
      workspaceId,
      userId,
      kind: 'notion-composio',
      serviceId: 'notion',
      connectorAuthProfileId: profileId,
      composioPendingId: pendingAccountId,
    });

    await request(app)
      .post(`/workspaces/${workspaceId}/connections/composio/finalize`)
      .send({ state, connectedAccountId: pendingAccountId })
      .expect(200);

    const [connection] = await dbMod.db
      .select()
      .from(dbMod.schema.connections)
      .where(eq(dbMod.schema.connections.composioConnectedAccountId, pendingAccountId));
    expect(connection).toMatchObject({
      workspaceId,
      kind: 'notion-composio',
      serviceId: 'notion',
      connectorAuthProfileId: profileId,
      composioConnectedAccountId: pendingAccountId,
    });
    expect(resolveProfile).toHaveBeenCalledWith({
      workspaceId,
      serviceId: 'notion',
      authProfileId: profileId,
    });
  });
  it.todo('rejects finalize when HMAC state is invalid');
  it.todo('rejects finalize when connected_account_id does not match pending');
  it.todo('creates a connection and kicks ingest on successful finalize');

  async function makeReadyWorkspace(): Promise<{ workspaceId: string; userId: string }> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `composio-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId: user.id,
        gbrainVersion: 'test-0.0.0',
        status: 'ready',
        gbrainBaseUrl: 'http://gbrain.test',
        gbrainOauthClientId: 'client-test',
        gbrainOauthClientSecretCiphertext: Buffer.from('secret'),
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceIds.push(workspace.id);
    return { workspaceId: workspace.id, userId: user.id };
  }

  async function makeComposioProfile(workspaceId: string, userId: string): Promise<string> {
    const profileId = randomUUID();
    await dbMod.db.insert(dbMod.schema.connectorAuthProfiles).values({
      id: profileId,
      workspaceId,
      provider: 'composio',
      mode: 'byok',
      label: 'Customer Composio',
      apiKeyCiphertext: Buffer.from('ciphertext'),
      createdByUserId: userId,
    });
    return profileId;
  }

  function buildApp(
    workspaceId: string,
    userId: string,
    deps: Parameters<typeof mod.buildComposioRouter>[0] = {},
  ) {
    // The /workspaces/:id/connections mount mirrors apps/api/src/index.ts; the
    // hoisted middleware mock above stands in for requireMembership.
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, _res, next) => {
      req.workspace = { id: workspaceId, role: 'owner' };
      req.session = { id: 'sess-test', userId };
      next();
    });
    app.use(
      '/workspaces/:id/connections',
      mod.buildComposioRouter({ kick: async () => undefined, ...deps }),
    );
    return app;
  }
  void buildApp; // referenced by todo tests once they land.
});
