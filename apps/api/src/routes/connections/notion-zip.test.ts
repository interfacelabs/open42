import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('notion zip connection upload route', () => {
  let mod: typeof import('./notion-zip.js');

  beforeAll(async () => {
    mod = await import('./notion-zip.js');
  });

  it('exports a router builder', () => {
    expect(typeof mod.buildNotionZipRouter).toBe('function');
  });

  it.todo('returns 401/403 for unauthenticated or non-owner callers');
  it.todo('returns 400 when no file is uploaded');
  it.todo('returns 409 when another Notion connection exists');
  it.todo('creates a pending_import notion-zip connection with cursor.zipPath');
  it.todo('kicks the workspace ingest scheduler');
});
