import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('workspace ingest routes', () => {
  let mod: typeof import('./ingest.js');

  beforeAll(async () => {
    mod = await import('./ingest.js');
  });

  it('exports a router builder', () => {
    expect(typeof mod.buildIngestRouter).toBe('function');
  });

  it.todo('GET returns ingest settings plus latest job');
  it.todo('PATCH validates mode and interval');
  it.todo('PATCH is owner-only');
  it.todo('POST sync returns 409 when cycle is already locked');
  it.todo('POST sync creates a running job before returning 202');
  it.todo('GET jobs returns workspace job history ordered by created_at desc');
});
