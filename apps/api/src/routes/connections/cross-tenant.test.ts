import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('Composio cross-tenant isolation plumbing', () => {
  let orchestrator: typeof import('../../ingest/orchestrator.js');
  let fake: typeof import('../../composio/fake.js');

  beforeAll(async () => {
    orchestrator = await import('../../ingest/orchestrator.js');
    fake = await import('../../composio/fake.js');
  });

  it('loads the fake Composio and orchestrator surfaces used by the isolation test', () => {
    expect(typeof orchestrator.runWorkspaceCycle).toBe('function');
    expect(typeof fake.createFakeComposio).toBe('function');
  });

  it.todo('runs workspace A with only workspace A connected_account_id');
  it.todo('leaves workspace B connection untouched during workspace A cycle');
  it.todo('moves mismatched Composio user_id connections to errored');
});
