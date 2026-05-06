import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('Composio connection routes', () => {
  let mod: typeof import('./composio.js');

  beforeAll(async () => {
    mod = await import('./composio.js');
  });

  it('exports a router builder for OAuth init/callback', () => {
    expect(typeof mod.buildComposioRouter).toBe('function');
  });

  it.todo('returns 401 when POST /init has no session');
  it.todo('returns 403 when caller is not workspace owner');
  it.todo('returns 409 when a Notion connection already exists');
  it.todo('inserts connection_init_states and returns redirect_url on init');
  it.todo('rejects callback with bad HMAC state');
  it.todo('rejects callback connected_account_id mismatch');
  it.todo('creates a connection and kicks ingest on successful callback');
});
