import { describe, it, expect, vi, beforeEach } from 'vitest';

const replaceMock = vi.fn();
vi.mock('next/router', () => ({
  default: { replace: (...args: unknown[]) => replaceMock(...args) },
}));

const recoverMock = vi.fn();
vi.mock('./store', () => ({
  useWorkspaceStore: {
    getState: () => ({ recoverFromForbidden: recoverMock }),
  },
}));

import { withRecovery } from './with-recovery';

describe('withRecovery', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    recoverMock.mockReset();
  });

  it('returns the parsed body when the response is OK', async () => {
    const doFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    } as unknown as Response));

    const result = await withRecovery<{ hello: string }>(doFetch);
    expect(result).toEqual({ hello: 'world' });
    expect(replaceMock).not.toHaveBeenCalled();
    expect(recoverMock).not.toHaveBeenCalled();
  });

  it('on 403 with switched outcome: calls recovery, routes to /, returns null', async () => {
    recoverMock.mockResolvedValue({ kind: 'switched', workspaceId: 'w-next' });
    const doFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as unknown as Response));

    const result = await withRecovery(doFetch);
    expect(result).toBeNull();
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/');
  });

  it('on 403 with no_workspaces outcome: routes to /auth/onboard, returns null', async () => {
    recoverMock.mockResolvedValue({ kind: 'no_workspaces' });
    const doFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as unknown as Response));

    const result = await withRecovery(doFetch);
    expect(result).toBeNull();
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith('/auth/onboard');
  });

  it('on other errors (500): rethrows with status attached', async () => {
    const doFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response));

    await expect(withRecovery(doFetch)).rejects.toMatchObject({
      message: 'fetch_failed',
      status: 500,
    });
    expect(recoverMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
