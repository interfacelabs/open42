/**
 * Focused unit tests for `runAcceptFlow` — the pure-logic core of the invite
 * accept page (extracted from `accept.tsx` in codex round-7 follow-up).
 *
 * These tests don't render React; they call `runAcceptFlow` directly with an
 * injected fetch mock and assert the returned outcome. The page-level
 * integration test in `apps/web/__tests__/auth/invite/accept.test.tsx` still
 * exercises the same paths end-to-end through the React tree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runAcceptFlow,
  type AcceptFlowDeps,
  type AcceptFlowInput,
} from '@/lib/invite/accept-flow';

/**
 * Builds a fetch mock keyed by URL prefix. Mirrors the dispatcher used in
 * `apps/web/__tests__/auth/invite/accept.test.tsx` so behavior stays
 * consistent between the unit and integration layers.
 */
function makeFetch(
  routes: Record<string, { ok: boolean; status: number; body: unknown }>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const key = String(url);
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    if (!match) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not_mocked' }),
      } as Response;
    }
    const r = routes[match]!;
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
    } as Response;
  });
}

function baseInput(overrides: Partial<AcceptFlowInput> = {}): AcceptFlowInput {
  return {
    inviteId: 'abc',
    tokenHash: 'xyz',
    type: 'invite',
    accessToken: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AcceptFlowDeps> = {}): AcceptFlowDeps & {
  refresh: ReturnType<typeof vi.fn>;
  switchTo: ReturnType<typeof vi.fn>;
  clearStash: ReturnType<typeof vi.fn>;
} {
  const refresh = vi.fn(async () => {});
  const switchTo = vi.fn(async (_id: string) => {});
  const clearStash = vi.fn();
  return {
    refreshStore: refresh,
    switchStoreTo: switchTo,
    clearPendingStash: clearStash,
    refresh,
    switchTo,
    clearStash,
    ...overrides,
  };
}

describe('runAcceptFlow — B1: signed in, email matches', () => {
  it('returns redirect, calls refresh + switchTo + clearStash on success', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: true,
        status: 200,
        body: { ok: true, workspace: { id: 'w2', name: 'X' } },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(deps.switchTo).toHaveBeenCalledWith('w2');
    expect(deps.clearStash).toHaveBeenCalledOnce();
  });

  it('swallows a benign switchTo throw (already-on-this-workspace) and still redirects', async () => {
    const deps = makeDeps();
    deps.switchTo.mockRejectedValueOnce(new Error('already on workspace'));
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: true,
        status: 200,
        body: { ok: true, workspace: { id: 'w2' } },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
  });

  it('does not call switchTo when accept response lacks a workspace id', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': { ok: true, status: 200, body: { ok: true } },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
    expect(deps.switchTo).not.toHaveBeenCalled();
  });

  it('maps invite_revoked to error outcome', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 409,
        body: { error: 'invite_revoked' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'error', message: 'invite_revoked' });
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('maps invite_already_accepted to redirect home and still refreshes the store', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 409,
        body: { error: 'invite_already_accepted' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(deps.clearStash).toHaveBeenCalledOnce();
  });

  it('maps invite_expired to expired outcome', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 400,
        body: { error: 'invite_expired' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'expired' });
  });
});

describe('runAcceptFlow — B2: signed in, email mismatch', () => {
  it('returns mismatch when no access_token is present', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'mismatch' });
    // The stash should NOT be cleared on mismatch — the post-signout reload
    // needs to pick it up.
    expect(deps.clearStash).not.toHaveBeenCalled();
  });

  it('with access_token: verifies, refreshes, redirects (skips sign-out roundtrip)', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/onboarding' } },
    });
    const out = await runAcceptFlow(
      baseInput({ accessToken: 'at-1' }),
      { ...deps, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out).toEqual({ kind: 'redirect', to: '/onboarding' });
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(deps.clearStash).toHaveBeenCalledOnce();
    // Body should carry the access_token, not the tokenHash.
    const verifyCall = fetchMock.mock.calls.find(
      ([u]) => String(u) === '/api/auth/verify',
    );
    expect(verifyCall).toBeTruthy();
    const body = JSON.parse(((verifyCall as unknown as [string, RequestInit])[1]).body as string);
    expect(body.accessToken).toBe('at-1');
    expect(body.tokenHash).toBeUndefined();
  });

  it('with access_token but verify returns invite_email_mismatch: falls back to mismatch UI (no loop)', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
      '/api/auth/verify': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
    });
    const out = await runAcceptFlow(
      baseInput({ accessToken: 'at-1' }),
      { ...deps, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out).toEqual({ kind: 'mismatch' });
  });

  it('with access_token but verify returns otp_expired: maps to expired', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
      '/api/auth/verify': {
        ok: false,
        status: 400,
        body: { error: 'otp_expired' },
      },
    });
    const out = await runAcceptFlow(
      baseInput({ accessToken: 'at-1' }),
      { ...deps, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out).toEqual({ kind: 'expired' });
  });
});

describe('runAcceptFlow — B3: not signed in', () => {
  it('falls through to /auth/verify with tokenHash when /me 401s; returns redirect on success', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
    expect(deps.clearStash).toHaveBeenCalledOnce();
    // Body should carry tokenHash + type + inviteId (no access_token).
    const verifyCall = fetchMock.mock.calls.find(
      ([u]) => String(u) === '/api/auth/verify',
    );
    const body = JSON.parse(((verifyCall as unknown as [string, RequestInit])[1]).body as string);
    expect(body.tokenHash).toBe('xyz');
    expect(body.type).toBe('invite');
    expect(body.inviteId).toBe('abc');
    expect(body.accessToken).toBeUndefined();
  });

  it('B3 with access_token prefers it over tokenHash in the verify body', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
    });
    await runAcceptFlow(
      baseInput({ accessToken: 'at-3' }),
      { ...deps, fetch: fetchMock as unknown as typeof fetch },
    );
    const verifyCall = fetchMock.mock.calls.find(
      ([u]) => String(u) === '/api/auth/verify',
    );
    const body = JSON.parse(((verifyCall as unknown as [string, RequestInit])[1]).body as string);
    expect(body.accessToken).toBe('at-3');
    expect(body.tokenHash).toBeUndefined();
  });

  it('B3 verify failure: invite_expired maps to expired', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': {
        ok: false,
        status: 400,
        body: { error: 'invite_expired' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'expired' });
  });

  it('B3 verify failure: unknown error maps to error with the server message', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': {
        ok: false,
        status: 500,
        body: { error: 'something_broke' },
      },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'error', message: 'something_broke' });
  });

  it('B3 verify failure with no body falls back to "unknown"', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: false, status: 500, body: {} },
    });
    const out = await runAcceptFlow(baseInput(), { ...deps, fetch: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: 'error', message: 'unknown' });
  });
});

describe('runAcceptFlow — /auth/me network failure', () => {
  it('treats a thrown /auth/me as not-signed-in and routes through B3', async () => {
    const deps = makeDeps();
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const key = String(url);
      if (key === '/api/auth/me') throw new Error('network');
      if (key === '/api/auth/verify') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ redirectTo: '/' }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    const out = await runAcceptFlow(baseInput(), {
      ...deps,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out).toEqual({ kind: 'redirect', to: '/' });
  });
});

describe('runAcceptFlow — default deps', () => {
  beforeEach(() => {
    // The default fetch path uses globalThis.fetch — we just need /auth/me to
    // hit something that resolves to not-signed-in, then /auth/verify ok.
  });

  it('uses globalThis.fetch when no fetch dep is provided', async () => {
    const deps = makeDeps();
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
    });
    const previous = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const out = await runAcceptFlow(baseInput(), {
        refreshStore: deps.refreshStore,
        switchStoreTo: deps.switchStoreTo,
        clearPendingStash: deps.clearPendingStash,
      });
      expect(out).toEqual({ kind: 'redirect', to: '/' });
    } finally {
      globalThis.fetch = previous;
    }
  });
});
