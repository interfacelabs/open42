import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspaceRow: null as null | {
    id: string;
    name: string;
    plan: string | null;
    status: string;
    gbrainBaseUrl: string | null;
    flyPrivateIp: string | null;
    gbrainOauthClientId: string | null;
    gbrainOauthClientSecretCiphertext: Buffer | null;
    createdAt: Date;
  },
  whereCalls: [] as unknown[],
  leftJoinCalls: [] as unknown[],
}));

vi.mock('../../db/client.js', () => {
  const column = {};
  const limit = vi.fn(async () => (state.workspaceRow ? [{ workspace: state.workspaceRow }] : []));
  const where = vi.fn((expr: unknown) => {
    state.whereCalls.push(expr);
    return { limit };
  });
  const leftJoin = vi.fn((table: unknown, expr: unknown) => {
    state.leftJoinCalls.push({ table, expr });
    return { where };
  });
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));
  return {
    schema: {
      workspaces: { id: column, ownerUserId: column, status: column },
      memberships: { workspaceId: column, userId: column },
      users: { id: column },
    },
    db: { select },
  };
});

const { currentWorkspaceForUser } = await import('./provision.js');

describe('currentWorkspaceForUser (membership-aware lookup)', () => {
  beforeEach(() => {
    state.workspaceRow = null;
    state.whereCalls = [];
    state.leftJoinCalls = [];
  });

  it('uses a left join on memberships and filters by owner OR membership', async () => {
    state.workspaceRow = {
      id: 'workspace-a',
      name: 'Workspace A',
      plan: null,
      status: 'ready',
      gbrainBaseUrl: 'http://1.2.3.4:8080',
      flyPrivateIp: null,
      gbrainOauthClientId: 'client-x',
      gbrainOauthClientSecretCiphertext: Buffer.from('secret'),
      createdAt: new Date('2026-05-07T10:00:00Z'),
    };

    const ws = await currentWorkspaceForUser('user-b');

    expect(ws).not.toBeNull();
    expect(ws?.id).toBe('workspace-a');
    // gbrainReady: gbrainBaseUrl + clientId + secret all present.
    expect(ws?.gbrainReady).toBe(true);
    expect(ws?.runtime).toBe('ready');
    expect(state.leftJoinCalls).toHaveLength(1);
    expect(state.whereCalls).toHaveLength(1);
  });

  it("returns null when neither owner nor member of any workspace", async () => {
    state.workspaceRow = null;
    const ws = await currentWorkspaceForUser('user-orphan');
    expect(ws).toBeNull();
  });

  it("derives runtime: 'pending' when status='ready' but gbrain unconfigured", async () => {
    state.workspaceRow = {
      id: 'workspace-a',
      name: 'Workspace A',
      plan: null,
      status: 'ready',
      gbrainBaseUrl: null,
      flyPrivateIp: null,
      gbrainOauthClientId: null,
      gbrainOauthClientSecretCiphertext: null,
      createdAt: new Date('2026-05-07T10:00:00Z'),
    };
    const ws = await currentWorkspaceForUser('user-b');
    expect(ws?.runtime).toBe('pending');
    expect(ws?.gbrainReady).toBe(false);
  });
});
