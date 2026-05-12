import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import {
  __resetWorkspaceStoreForTests,
  useHydrateWorkspaceStore,
  useWorkspaceStore,
} from './store';

/**
 * Tests for the `useHydrateWorkspaceStore` per-user latch (codex round-7 P2).
 *
 * The hook probes /api/auth/me on mount and only fires the workspace refresh
 * when the returned user id differs from the one the store was last hydrated
 * for. This catches the signout → signin same-tab case that the old boolean
 * `_hydrated` flag silently missed.
 */

function HydrateProbe() {
  useHydrateWorkspaceStore();
  return null;
}

function routedFetch(opts: {
  meUserId?: string | null; // null → 401
  workspaces?: unknown[];
}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = String(url);
    if (key === '/api/auth/me') {
      if (opts.meUserId === null) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: opts.meUserId ?? 'u1',
          email: 'u@x.com',
          currentWorkspaceId: null,
        }),
      } as Response;
    }
    if (key === '/api/workspaces') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ workspaces: opts.workspaces ?? [] }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
}

async function flush() {
  // The hook does: fetch(/auth/me) → JSON parse → fetch(/workspaces + /auth/me)
  // → setState. Two macrotask flushes are enough — the awaits inside the IIFE
  // are all resolved promises.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('useHydrateWorkspaceStore — per-user hydration latch', () => {
  beforeEach(() => {
    __resetWorkspaceStoreForTests();
  });

  it('first mount: probes /auth/me, then refreshes the store for that user', async () => {
    const fetchMock = routedFetch({
      meUserId: 'u-first',
      workspaces: [{ id: 'w1', name: 'A', role: 'owner', status: 'ready' }],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HydrateProbe />);
    await flush();

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain('/api/auth/me');
    expect(calls).toContain('/api/workspaces');
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
  });

  it('second mount with same user id: probes /auth/me but skips workspaces refresh', async () => {
    // First mount populates the latch + the store.
    const firstFetch = routedFetch({
      meUserId: 'u-same',
      workspaces: [{ id: 'w1', name: 'A', role: 'owner', status: 'ready' }],
    });
    global.fetch = firstFetch as unknown as typeof fetch;
    const { unmount } = render(<HydrateProbe />);
    await flush();
    unmount();

    // Second mount with a fresh fetch mock. Should hit /auth/me to check the
    // user id, find a match, and short-circuit before /workspaces.
    const secondFetch = routedFetch({ meUserId: 'u-same' });
    global.fetch = secondFetch as unknown as typeof fetch;
    render(<HydrateProbe />);
    await flush();

    const wsCalls = secondFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u === '/api/workspaces');
    expect(wsCalls).toHaveLength(0);
  });

  it('second mount with different user id (signout+signin same tab): refreshes again', async () => {
    // First mount hydrates for u-old.
    const firstFetch = routedFetch({
      meUserId: 'u-old',
      workspaces: [{ id: 'w-old', name: 'Old', role: 'owner', status: 'ready' }],
    });
    global.fetch = firstFetch as unknown as typeof fetch;
    const { unmount } = render(<HydrateProbe />);
    await flush();
    unmount();

    // Same tab, different user signs in. /auth/me reports a new id; the hook
    // must detect the mismatch and refresh.
    const secondFetch = routedFetch({
      meUserId: 'u-new',
      workspaces: [{ id: 'w-new', name: 'New', role: 'member', status: 'ready' }],
    });
    global.fetch = secondFetch as unknown as typeof fetch;
    render(<HydrateProbe />);
    await flush();

    const wsCalls = secondFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u === '/api/workspaces');
    expect(wsCalls).toHaveLength(1);
    // Store should now contain the new user's workspaces.
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(['w-new']);
  });

  it('mount when /auth/me 401s: leaves the store unchanged, does not crash', async () => {
    const fetchMock = routedFetch({ meUserId: null });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HydrateProbe />);
    await flush();

    // /workspaces is never called because the probe failed.
    const wsCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u === '/api/workspaces');
    expect(wsCalls).toHaveLength(0);
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
  });
});
