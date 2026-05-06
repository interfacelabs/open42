import { beforeAll, describe, expect, it } from 'vitest';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb('runWorkspaceCycle', () => {
  let mod: typeof import('./orchestrator.js');

  beforeAll(async () => {
    mod = await import('./orchestrator.js');
  });

  it('exports the cycle runner and scheduler surface', () => {
    expect(typeof mod.runWorkspaceCycle).toBe('function');
    expect(typeof mod.startScheduler).toBe('function');
  });

  it.todo('advances cursor and marks pollable connections active after successful delivery');
  it.todo('records connector failure while allowing other connectors to succeed');
  it.todo('advances zero-doc successful connectors without submitting to gbrain');
  it.todo('marks one-shot notion-zip connections completed and deletes their zip file');
  it.todo('does not advance cursors when gbrain submit or poll fails');
  it.todo('aborts without commits when heartbeat loses the workspace lock');
  it.todo('moves Composio workspace mismatches to errored before extraction');
  it.todo('skips Composio integrity checks for notion-zip connections');
  it.todo('writes a completed no-op job for cycles with no eligible connections');
});
