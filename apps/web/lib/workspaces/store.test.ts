import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceStore } from './store';

/**
 * refresh() fetches /api/workspaces and /api/auth/me in parallel. The fetch
 * mocks below dispatch by URL to keep the tests robust against ordering.
 */
function routedFetch(routes: {
  workspaces?: { ok: boolean; status?: number; body: unknown };
  me?: { ok: boolean; status?: number; body: unknown };
}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = String(url);
    if (key === '/api/workspaces') {
      const r = routes.workspaces ?? { ok: true, body: { workspaces: [] } };
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: async () => r.body,
      } as Response;
    }
    if (key === '/api/auth/me') {
      const r = routes.me ?? { ok: false, status: 401, body: { error: 'unauthorized' } };
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 401),
        json: async () => r.body,
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_mocked' }),
    } as Response;
  });
}

describe('workspace store', () => {
  let store: ReturnType<typeof createWorkspaceStore>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    store = createWorkspaceStore({ fetch: fetchMock as unknown as typeof fetch });
  });

  it('refresh() loads workspaces and sets current to the first one when none set (no server hint)', async () => {
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: {
          ok: true,
          body: {
            workspaces: [
              { id: 'w1', name: 'A', role: 'owner', status: 'ready' },
              { id: 'w2', name: 'B', role: 'member', status: 'ready' },
            ],
          },
        },
        // /auth/me returns no current — empty server hint.
        me: { ok: true, body: { id: 'u1', email: 'u@x.com', currentWorkspaceId: null } },
      }),
    );
    await store.getState().refresh();
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me');
    expect(store.getState().workspaces).toHaveLength(2);
    expect(store.getState().currentWorkspaceId).toBe('w1');
    expect(store.getState().loading).toBe(false);
  });

  it('refresh() honors the server currentWorkspaceId on fresh load even when it is not the first list entry', async () => {
    // Fresh mount: localCurrent is null. Server says w2 is the current
    // choice (e.g. user just accepted an invite into w2). The store must
    // pick w2 even though w1 is first in the list (owner-first ordering).
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: {
          ok: true,
          body: {
            workspaces: [
              { id: 'w1', name: 'A', role: 'owner', status: 'ready' },
              { id: 'w2', name: 'B', role: 'member', status: 'ready' },
            ],
          },
        },
        me: { ok: true, body: { id: 'u1', email: 'u@x.com', currentWorkspaceId: 'w2' } },
      }),
    );
    await store.getState().refresh();
    expect(store.getState().currentWorkspaceId).toBe('w2');
  });

  it('refresh() preserves the local current selection over the server hint when both are members', async () => {
    // The user is actively in w2 (the local store knows that). The server
    // still reports w1 as currentWorkspaceId (e.g. they switched in another
    // tab). Local choice wins so a mid-session refresh doesn't yank them
    // back. The next /switch will reconcile the server.
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: {
          ok: true,
          body: {
            workspaces: [
              { id: 'w1', name: 'A', role: 'owner', status: 'ready' },
              { id: 'w2', name: 'B', role: 'member', status: 'ready' },
            ],
          },
        },
        me: { ok: true, body: { id: 'u1', email: 'u@x.com', currentWorkspaceId: 'w1' } },
      }),
    );
    store.setState({ currentWorkspaceId: 'w2' });
    await store.getState().refresh();
    expect(store.getState().currentWorkspaceId).toBe('w2');
  });

  it('refresh() falls back to first list entry when /auth/me 401s', async () => {
    // Edge case: /auth/me unauthorized but /workspaces returns a list (e.g.
    // a transient session glitch). Don't crash — pick first.
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: {
          ok: true,
          body: {
            workspaces: [{ id: 'w1', name: 'A', role: 'owner', status: 'ready' }],
          },
        },
        me: { ok: false, status: 401, body: { error: 'unauthorized' } },
      }),
    );
    await store.getState().refresh();
    expect(store.getState().currentWorkspaceId).toBe('w1');
  });

  it('switchTo() calls POST /api/workspaces/:id/switch and updates currentWorkspaceId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, workspace: { id: 'w2', name: 'B', status: 'ready' } }),
    });
    await store.getState().switchTo('w2');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/w2/switch',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(store.getState().currentWorkspaceId).toBe('w2');
  });

  it('switchTo() sends the X-CSRF-Token header read from the open42_csrf cookie', async () => {
    // jsdom (vitest's default environment for web) exposes a writable
    // document.cookie. csrfHeaders() reads it case-sensitively on the
    // canonical key.
    document.cookie = 'open42_csrf=abc123';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await store.getState().switchTo('w2');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers).toMatchObject({ 'X-CSRF-Token': 'abc123' });
    // Clean up so other tests aren't polluted.
    document.cookie = 'open42_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('recoverFromForbidden() refreshes, picks the first available, calls switch', async () => {
    // refresh() fans out to /workspaces + /auth/me; then switchTo POSTs to
    // /api/workspaces/:id/switch. Route by URL so order doesn't matter.
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      const key = String(url);
      if (key === '/api/workspaces') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            workspaces: [{ id: 'w3', name: 'C', role: 'member', status: 'ready' }],
          }),
        } as Response;
      }
      if (key === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'u1', email: 'u@x.com', currentWorkspaceId: null }),
        } as Response;
      }
      if (key === '/api/workspaces/w3/switch') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, workspace: { id: 'w3', name: 'C', status: 'ready' } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    const next = await store.getState().recoverFromForbidden();
    expect(next).toEqual({ kind: 'switched', workspaceId: 'w3' });
    expect(store.getState().currentWorkspaceId).toBe('w3');
  });

  it('recoverFromForbidden() returns kind=no_workspaces when refresh yields empty', async () => {
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: { ok: true, body: { workspaces: [] } },
        me: { ok: true, body: { id: 'u1', email: 'u@x.com', currentWorkspaceId: null } },
      }),
    );
    const next = await store.getState().recoverFromForbidden();
    expect(next).toEqual({ kind: 'no_workspaces' });
    expect(store.getState().currentWorkspaceId).toBeNull();
    // Only the refresh fan-out should have fired (/workspaces + /auth/me)
    // — no switch attempt.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refresh sets lastError when /workspaces fetch fails non-ok', async () => {
    fetchMock.mockImplementation(
      routedFetch({
        workspaces: { ok: false, status: 500, body: {} },
        me: { ok: true, body: { id: 'u1', email: 'u@x.com', currentWorkspaceId: null } },
      }),
    );
    await store.getState().refresh();
    expect(store.getState().lastError).toMatch(/workspaces_fetch_failed:500/);
    expect(store.getState().workspaces).toEqual([]);
  });
});
