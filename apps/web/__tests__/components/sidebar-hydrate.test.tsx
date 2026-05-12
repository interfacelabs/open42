import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/',
    asPath: '/',
    push: vi.fn(),
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Render the Sidebar's real implementation but stub the heavy child (the
// switcher); we only care that the Sidebar mounting triggers ONE fetch to
// /api/workspaces via the hydrate hook.
vi.mock('@/components/WorkspaceSwitcher', () => ({
  default: () => <div data-testid="workspace-switcher" />,
}));

// SWR is left untouched: it'll fire its own requests for /api/workspaces/current
// and (when the store has a workspace id) /api/workspaces/:id/skills; we just
// need to count the `/api/workspaces` calls (no trailing path), which only the
// hydrate hook makes.

import { Sidebar } from '@/components/Sidebar';
import { __resetWorkspaceStoreForTests } from '@/lib/workspaces/store';

/**
 * Route a fetch URL to the right canned response. The hydrate hook now
 * probes /api/auth/me first (codex round-7 P2: per-user hydration latch)
 * and only fans out to /api/workspaces + /api/auth/me when the response
 * names a different user than the previous mount.
 */
function routedFetch(opts: {
  meUserId?: string | null; // null → /auth/me 401s
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
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response;
  });
}

describe('Sidebar — workspace store hydration', () => {
  beforeEach(() => {
    __resetWorkspaceStoreForTests();
  });

  it('fires exactly one GET /api/workspaces on mount via the hydrate hook', async () => {
    const fetchMock = routedFetch({ meUserId: 'u1' });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<Sidebar />);

    // Flush microtasks so the useEffect runs and the refresh() promise resolves.
    // Two awaits: one for the /auth/me probe, one for the refresh() fan-out.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const hydrateCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (call) => String(call[0]) === '/api/workspaces',
    );
    expect(hydrateCalls).toHaveLength(1);
  });

  it('is idempotent across remounts within the same page load (same user)', async () => {
    const fetchMock = routedFetch({ meUserId: 'u1' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = render(<Sidebar />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    render(<Sidebar />);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const hydrateCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (call) => String(call[0]) === '/api/workspaces',
    );
    // Only the first mount hits /api/workspaces — subsequent mounts probe
    // /auth/me, see the same user id, and short-circuit.
    expect(hydrateCalls).toHaveLength(1);
  });
});
