import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
      await dbMod.db.delete(dbMod.schema.workspaces).where(eq(dbMod.schema.workspaces.id, workspaceId));
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
  it.todo('inserts connection_init_states and returns redirect_url on init');
  it.todo('rejects finalize when HMAC state is invalid');
  it.todo('rejects finalize when connected_account_id does not match pending');
  it.todo('creates a connection and kicks ingest on successful finalize');

  function buildApp(_workspaceId: string) {
    // The /workspaces/:id/connections mount mirrors apps/api/src/index.ts; the
    // hoisted middleware mock above stands in for requireMembership.
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(
      '/workspaces/:id/connections',
      mod.buildComposioRouter({ kick: async () => undefined }),
    );
    return app;
  }
  void buildApp; // referenced by todo tests once they land.
});
