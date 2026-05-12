/**
 * Tests for the Composio OAuth callback page.
 *
 * Codex round-2 P2: the finalize URL's workspaceId MUST come from the
 * (server-signed, client-decoded) OAuth state, not from
 * `/api/workspaces/current`. If the user switches workspaces between init
 * and callback, /workspaces/current can disagree with the workspaceId
 * baked into the HMAC state — the API then rejects with
 * `state_metadata_mismatch`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  routerQuery: { current: {} as Record<string, unknown> },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mocks.routerQuery.current;
    },
    replace: mocks.replaceMock,
    pathname: '/auth/connections/composio/callback',
  }),
}));

vi.mock('@/lib/csrf', () => ({
  csrfHeaders: () => ({ 'X-CSRF-Token': 'test-csrf' }),
}));

import ComposioCallbackPage, {
  extractWorkspaceIdFromState,
} from '@/pages/connections/composio/callback';

/**
 * Build a fake state token in the same `<base64url(JSON)>.<hmac>` shape the
 * API's signState helper produces. We don't need a real HMAC for the
 * client-side decode — only the JSON payload matters.
 */
function makeStateToken(payload: Record<string, unknown>, hmac = 'fake-hmac'): string {
  const json = JSON.stringify(payload);
  // base64url-encode in a way that matches Buffer.toString('base64url')
  // — strip padding and swap +//= for -/_.
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${hmac}`;
}

describe('extractWorkspaceIdFromState', () => {
  it('returns the workspaceId from a well-formed state token', () => {
    const token = makeStateToken({
      workspaceId: 'ws-from-state',
      userId: 'u',
      nonce: 'n',
      expiresAt: Date.now() + 60_000,
    });
    expect(extractWorkspaceIdFromState(token)).toBe('ws-from-state');
  });

  it('returns null when the state has no dot separator', () => {
    expect(extractWorkspaceIdFromState('just-some-string')).toBeNull();
  });

  it('returns null when the payload is malformed JSON', () => {
    const b64 = btoa('not-json').replace(/=+$/, '');
    expect(extractWorkspaceIdFromState(`${b64}.fake-hmac`)).toBeNull();
  });

  it('returns null when workspaceId is missing from the payload', () => {
    const token = makeStateToken({ userId: 'u' });
    expect(extractWorkspaceIdFromState(token)).toBeNull();
  });

  it('returns null when workspaceId is empty', () => {
    const token = makeStateToken({ workspaceId: '' });
    expect(extractWorkspaceIdFromState(token)).toBeNull();
  });
});

describe('ComposioCallbackPage finalize URL', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.replaceMock.mockReset();
    mocks.routerQuery.current = {};
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finalizes against the workspaceId from the signed state, NOT /workspaces/current', async () => {
    // State carries `ws-from-state`. /workspaces/current would say `ws-other`.
    // If the page uses /workspaces/current it would hit the wrong URL and
    // the API would reject with state_metadata_mismatch — instead, finalize
    // must go to ws-from-state.
    const stateToken = makeStateToken({
      workspaceId: 'ws-from-state',
      userId: 'u',
      nonce: 'n',
      expiresAt: Date.now() + 60_000,
    });

    mocks.routerQuery.current = {
      state: stateToken,
      connected_account_id: 'cac-1',
      status: 'success',
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/finalize')) {
        return {
          ok: true,
          json: async () => ({ redirectTo: '/' }),
        } as Response;
      }
      // /workspaces/current — return a DIFFERENT workspace to prove it's
      // not what determines the finalize URL.
      if (url === '/api/workspaces/current') {
        return {
          ok: true,
          json: async () => ({ workspace: { id: 'ws-other' } }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ComposioCallbackPage />);

    await waitFor(() => {
      const finalizeCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/finalize'),
      );
      expect(finalizeCall).toBeDefined();
      const [url, init] = finalizeCall!;
      expect(url).toBe('/api/workspaces/ws-from-state/connections/composio/finalize');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init!.body as string);
      expect(body.state).toBe(stateToken);
      expect(body.connectedAccountId).toBe('cac-1');
    });

    // /workspaces/current must not be queried when the state is decodable —
    // it's only a fallback for malformed state tokens.
    const calledCurrent = fetchMock.mock.calls.some(([url]) =>
      typeof url === 'string' && url === '/api/workspaces/current',
    );
    expect(calledCurrent).toBe(false);
  });

  it('falls back to /workspaces/current only when the state cannot be decoded', async () => {
    mocks.routerQuery.current = {
      state: 'totally-malformed',
      connected_account_id: 'cac-1',
      status: 'success',
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/workspaces/current') {
        return {
          ok: true,
          json: async () => ({ workspace: { id: 'ws-current' } }),
        } as Response;
      }
      if (url.includes('/finalize')) {
        return {
          ok: true,
          json: async () => ({ redirectTo: '/' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ComposioCallbackPage />);

    await waitFor(() => {
      const finalizeCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/finalize'),
      );
      expect(finalizeCall).toBeDefined();
      expect(finalizeCall![0]).toBe(
        '/api/workspaces/ws-current/connections/composio/finalize',
      );
    });
  });
});
