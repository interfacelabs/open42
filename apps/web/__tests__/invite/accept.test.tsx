import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  return {
    replaceMock: vi.fn(),
    routerQuery: { current: { invite_id: 'abc', token_hash: 'xyz', type: 'invite' } as Record<string, unknown> },
  };
});

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mocks.routerQuery.current;
    },
    replace: mocks.replaceMock,
    pathname: '/invite/accept',
  }),
}));

import AcceptInvitePage from '@/pages/invite/accept';
import { __resetWorkspaceStoreForTests, useWorkspaceStore } from '@/lib/workspaces/store';

/**
 * Builds a fetch mock keyed by URL prefix:
 *   - /api/auth/me               → returns { ok, status, body } you provide
 *   - /api/workspaces/invites/.../accept → likewise
 *   - /api/auth/verify           → likewise
 */
function makeFetch(routes: Record<string, { ok: boolean; status: number; body: unknown }>) {
  return vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const key = String(url);
    const match = Object.keys(routes).find((k) => key.startsWith(k));
    if (!match) {
      return { ok: false, status: 404, json: async () => ({ error: 'not_mocked' }) } as Response;
    }
    const r = routes[match]!;
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body,
    } as Response;
  });
}

beforeEach(() => {
  mocks.replaceMock.mockReset();
  mocks.routerQuery.current = { invite_id: 'abc', token_hash: 'xyz', type: 'invite' };
  if (typeof window !== 'undefined') {
    window.sessionStorage.clear();
    // Reset the URL hash between tests — the B2-with-access_token case
    // mutates window.location.hash and would otherwise leak into siblings.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '',
        href: 'http://localhost/invite/accept',
      },
    });
  }
  __resetWorkspaceStoreForTests();
});

describe('AcceptInvitePage — common', () => {
  it('renders verifying state on mount', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    expect(screen.getByText(/Checking/i)).toBeInTheDocument();
  });
});

describe('AcceptInvitePage — B1: signed in, email matches', () => {
  it('GETs /auth/me, POSTs to accept endpoint, redirects to / on success', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': { ok: true, status: 200, body: { ok: true } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'GET' }));
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/invites/abc/accept',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('refreshes the workspace store with the new workspace before redirecting', async () => {
    // Codex round-3 P2: the server flipped users.current_workspace_id to
    // the invite's workspace, but the client previously redirected without
    // refreshing the store; useHydrateWorkspaceStore's _hydrated latch then
    // blocked a second refresh on the dashboard, leaving the store empty
    // / pointed at a stale workspace. Assert that /api/workspaces hits
    // BEFORE replace('/') and that the new workspace lands in the store.
    const fetchMock = makeFetch({
      '/api/auth/me': {
        ok: true,
        status: 200,
        body: { id: 'u1', email: 'invitee@x.com', currentWorkspaceId: 'w2' },
      },
      '/api/workspaces/invites/abc/accept': {
        ok: true,
        status: 200,
        body: { ok: true, workspace: { id: 'w2', name: 'Invited Org', status: 'ready' } },
      },
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: {
          workspaces: [{ id: 'w2', name: 'Invited Org', role: 'member', status: 'ready' }],
        },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
    // The accept POST and the workspaces refresh both fired.
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toContain('/api/workspaces/invites/abc/accept');
    expect(urls).toContain('/api/workspaces');
    // After accept + refresh, the store mirrors the new workspace.
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w2');
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toContain('w2');
  });

  it('force-switches the store to the accepted workspace even when localCurrent is still a valid membership', async () => {
    // Codex round-6 P1: an already-onboarded user accepts an invite while
    // their previous workspace is still active in the store. refresh()'s
    // resolution order prefers a still-valid localCurrent, so without an
    // explicit switchTo the dashboard mounts on the OLD workspace and chat
    // sends the wrong workspace_id. The accept response carries the new
    // workspace id; the page must use it to force-switch.
    useWorkspaceStore.setState({ currentWorkspaceId: 'old-ws' });
    const fetchMock = makeFetch({
      '/api/auth/me': {
        ok: true,
        status: 200,
        body: { id: 'u1', email: 'invitee@x.com', currentWorkspaceId: 'new-ws' },
      },
      '/api/workspaces/invites/abc/accept': {
        ok: true,
        status: 200,
        body: { ok: true, workspace: { id: 'new-ws', name: 'New', status: 'ready' } },
      },
      '/api/workspaces/new-ws/switch': { ok: true, status: 200, body: { ok: true } },
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: {
          workspaces: [
            { id: 'old-ws', name: 'Old', role: 'owner', status: 'ready' },
            { id: 'new-ws', name: 'New', role: 'member', status: 'ready' },
          ],
        },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
    // The switch endpoint for the NEW workspace must have been called.
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toContain('/api/workspaces/new-ws/switch');
    // The store ends up on the new workspace, not the old one.
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('new-ws');
  });

  it('includes X-CSRF-Token header on the accept POST when cookie is set', async () => {
    // Seed the cookie *before* render so csrfHeaders() reads it on accept.
    document.cookie = 'open42_csrf=csrf-token-value';
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': { ok: true, status: 200, body: { ok: true } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      const acceptCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === '/api/workspaces/invites/abc/accept',
      );
      expect(acceptCall).toBeTruthy();
      const init = acceptCall![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-token-value');
    });
    document.cookie = 'open42_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

describe('AcceptInvitePage — B2: signed in, email mismatch', () => {
  it('shows mismatch UI when accept returns 403 invite_email_mismatch; sessionStorage holds credentials', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/different email/i)).toBeInTheDocument();
    });
    // Stash should be there for the post-signout reload to pick up.
    const raw = window.sessionStorage.getItem('open42:pending_invite');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toMatchObject({ inviteId: 'abc', tokenHash: 'xyz' });
  });

  it('B2 with access_token: skips sign-out screen, verifies the access_token, accepts the invite', async () => {
    // Codex round-6 P2: when Supabase delivers the invite via URL hash with
    // an access_token (not just a tokenHash), the access_token already
    // authenticates the user as the invitee. The page should verify the
    // access_token instead of forcing a sign-out roundtrip — the verify
    // call replaces the session and accepts the invite atomically.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '#access_token=at-1&type=invite',
        href: 'http://localhost/invite/accept#access_token=at-1&type=invite',
      },
    });
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: { workspaces: [] },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toContain('/api/auth/verify');
    // Body should carry the access_token, not the tokenHash.
    const verifyCall = fetchMock.mock.calls.find(
      ([u]) => String(u) === '/api/auth/verify',
    );
    const verifyBody = JSON.parse((verifyCall![1] as RequestInit).body as string);
    expect(verifyBody.accessToken).toBe('at-1');
    expect(verifyBody.inviteId).toBe('abc');
    // The mismatch UI should NOT have rendered.
    expect(screen.queryByText(/different email/i)).not.toBeInTheDocument();
  });

  it('Sign out button POSTs /api/auth/signout with CSRF header and reloads', async () => {
    // Codex round-2 P2: the backend enforces CSRF on /auth/signout; without
    // the header the POST 403s as csrf_token_invalid, the catch swallows
    // it, and the user is stuck on the mismatch screen with no way out.
    // Seed the cookie before render so csrfHeaders() reads it on signout.
    document.cookie = 'open42_csrf=csrf-token-value';
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadMock, hash: '', href: 'http://localhost/invite/accept' },
    });
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'other@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 403,
        body: { error: 'invite_email_mismatch' },
      },
      '/api/auth/signout': { ok: true, status: 200, body: { ok: true } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/different email/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => {
      const signoutCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === '/api/auth/signout',
      );
      expect(signoutCall).toBeTruthy();
      const init = signoutCall![1] as RequestInit;
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-token-value');
    });
    document.cookie = 'open42_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

describe('AcceptInvitePage — B3: not signed in', () => {
  it('falls through to /api/auth/verify when /me returns 401', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify', expect.objectContaining({ method: 'POST' }));
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
  });
});

describe('AcceptInvitePage — error branches', () => {
  it('B1 path: maps 409 invite_revoked to error state', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 409,
        body: { error: 'invite_revoked' },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      // generic error heading
      expect(screen.getByText(/went wrong/i)).toBeInTheDocument();
    });
  });

  it('B1 path: maps 400 invite_expired to expired state', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 400,
        body: { error: 'invite_expired' },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/has expired/i)).toBeInTheDocument();
    });
  });

  it('B1 path: maps 409 invite_already_accepted to redirect home', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: true, status: 200, body: { id: 'u1', email: 'invitee@x.com' } },
      '/api/workspaces/invites/abc/accept': {
        ok: false,
        status: 409,
        body: { error: 'invite_already_accepted' },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('B3 path: maps invite_expired error to expired state', async () => {
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: false, status: 400, body: { error: 'invite_expired' } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/has expired/i)).toBeInTheDocument();
    });
  });
});

describe('AcceptInvitePage — sessionStorage rehydrate', () => {
  it('reads sessionStorage stash when URL has no token (post-signout reload)', async () => {
    window.sessionStorage.setItem(
      'open42:pending_invite',
      JSON.stringify({ inviteId: 'stashed-id', tokenHash: 'stashed-hash', type: 'invite' }),
    );
    mocks.routerQuery.current = {}; // simulate the URL stripped after signout
    const fetchMock = makeFetch({
      '/api/auth/me': { ok: false, status: 401, body: { error: 'unauthorized' } },
      '/api/auth/verify': { ok: true, status: 200, body: { redirectTo: '/' } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/auth/verify');
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.inviteId).toBe('stashed-id');
      expect(body.tokenHash).toBe('stashed-hash');
    });
  });
});
