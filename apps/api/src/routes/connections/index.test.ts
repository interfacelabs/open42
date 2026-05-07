import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('connections list/disconnect routes', () => {
  let mod: typeof import('./index.js');

  beforeAll(async () => {
    mod = await import('./index.js');
  });

  it('exports a router builder', () => {
    expect(typeof mod.buildConnectionsRouter).toBe('function');
  });

  it.todo('returns 401 when unauthenticated');
  it.todo('lists only caller workspace non-deleted connections');
  it.todo('marks a connection disconnected and deleted');
  it.todo('best-effort deletes Composio connected account');
  it.todo('returns 404 when connection belongs to another workspace');
});
