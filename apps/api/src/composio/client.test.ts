import { describe, expect, it } from 'vitest';
import { activateFakeAccount, createFakeComposio } from './fake.js';

describe('createFakeComposio', () => {
  it('records initiate calls and returns a redirect_url + pending id', async () => {
    const fake = createFakeComposio();
    const res = await fake.initiateConnection({
      user_id: 'workspace-1',
      app: 'notion',
      auth_config_id: 'ac_test',
      redirect_uri: 'https://app/cb',
    });
    expect(res.redirect_url).toContain('composio.fake');
    expect(res.pending_connected_account_id).toMatch(/^fake-pending-/);
    expect(fake.recordedInitiates).toHaveLength(1);
  });

  it('getConnection reflects activateFakeAccount', async () => {
    const fake = createFakeComposio();
    const init = await fake.initiateConnection({
      user_id: 'workspace-1',
      app: 'notion',
      auth_config_id: 'ac_test',
      redirect_uri: 'https://app/cb',
    });
    activateFakeAccount(fake, init.pending_connected_account_id);
    const got = await fake.getConnection(init.pending_connected_account_id);
    expect(got.status).toBe('ACTIVE');
    expect(got.user_id).toBe('workspace-1');
  });

  it('executeTool dispatches to per-tool handler and records', async () => {
    const fake = createFakeComposio({
      toolHandlers: {
        TEST_TOOL: async (p) => ({ echoed: p.args }),
      },
    });
    const res = await fake.executeTool<{ echoed: Record<string, unknown> }>({
      tool: 'TEST_TOOL',
      account: 'fake-pending-1',
      args: { foo: 'bar' },
    });
    expect(res.echoed).toEqual({ foo: 'bar' });
    expect(fake.recordedExecutes).toHaveLength(1);
  });

  it('deleteConnection removes the account', async () => {
    const fake = createFakeComposio({
      seedConnections: [{ id: 'a1', status: 'ACTIVE', user_id: 'w', app: 'notion' }],
    });
    await fake.deleteConnection('a1');
    expect(fake.recordedDeletes).toEqual(['a1']);
    await expect(fake.getConnection('a1')).rejects.toThrow();
  });
});
