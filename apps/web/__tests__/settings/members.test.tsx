import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// hoist-safe shared mocks via vi.hoisted so vi.mock factories can access them.
const mocks = vi.hoisted(() => {
  const recoverFromForbidden = vi.fn();
  const replaceMock = vi.fn();
  const routerQuery: { current: Record<string, unknown> } = { current: {} };
  const storeState: {
    workspaces: Array<{
      id: string;
      name: string;
      role: 'owner' | 'admin' | 'member';
      status: 'provisioning' | 'ready' | 'failed';
    }>;
    currentWorkspaceId: string | null;
    allowMultiWorkspace: boolean;
    refresh: () => Promise<void>;
    switchTo: () => Promise<void>;
    recoverFromForbidden: ReturnType<typeof vi.fn>;
  } = {
    workspaces: [
      { id: 'ws1', name: 'Speedrun', role: 'owner', status: 'ready' },
    ],
    currentWorkspaceId: 'ws1',
    allowMultiWorkspace: false,
    refresh: () => Promise.resolve(),
    switchTo: () => Promise.resolve(),
    recoverFromForbidden,
  };
  return { recoverFromForbidden, replaceMock, routerQuery, storeState };
});
const { recoverFromForbidden, replaceMock, routerQuery, storeState } = mocks;

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mocks.routerQuery.current;
    },
    replace: mocks.replaceMock,
    push: () => Promise.resolve(true),
    pathname: '/settings/members',
    asPath: '/settings/members',
    events: { on: () => {}, off: () => {} },
  }),
  default: { replace: mocks.replaceMock },
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

vi.mock('@/lib/workspaces/store', () => ({
  useWorkspaceStore: Object.assign(
    (selector?: (state: typeof mocks.storeState) => unknown) =>
      selector ? selector(mocks.storeState) : mocks.storeState,
    { getState: () => mocks.storeState },
  ),
  // The Sidebar (rendered inside MembersSettingsPage) now calls
  // useHydrateWorkspaceStore() to refresh on mount. The test mock seeds the
  // store directly, so the hydrate hook is a no-op here.
  useHydrateWorkspaceStore: () => undefined,
}));

import useSWR from 'swr';

import MembersSettingsPage from '@/pages/settings/members';

type SWRMock = ReturnType<typeof vi.fn>;

/**
 * Sets the SWR mock so each call resolves to a stable response shape based on
 * the key (URL string). Keys we use:
 *   - /api/auth/me                                  → me object
 *   - /api/workspaces                               → workspaces list
 *   - /api/workspaces/ws1/members                   → { members: [...] }
 *   - /api/workspaces/ws1/invites                   → { invites: [...] }
 */
function mockSwr(map: Record<string, { data?: unknown; error?: unknown; status?: number }>) {
  const mutate = vi.fn();
  (useSWR as unknown as SWRMock).mockImplementation((key: unknown) => {
    const k = typeof key === 'string' ? key : '';
    const entry = map[k];
    if (!entry) return { data: undefined, error: null, mutate, isLoading: false };
    if (entry.error) {
      const e = new Error('fetch_failed') as Error & { status?: number };
      e.status = entry.status;
      return { data: undefined, error: e, mutate, isLoading: false };
    }
    return { data: entry.data, error: null, mutate, isLoading: false };
  });
  return mutate;
}

const OWNER_MEMBER = { userId: 'u-owner', email: 'me@x.com', role: 'owner', joinedAt: new Date('2026-01-01').toISOString() };
const ADMIN_MEMBER = { userId: 'u-admin', email: 'admin@x.com', role: 'admin', joinedAt: new Date('2026-01-02').toISOString() };
const PLAIN_MEMBER = { userId: 'u-member', email: 'member@x.com', role: 'member', joinedAt: new Date('2026-01-03').toISOString() };

const PENDING_INVITE = {
  id: 'inv-1',
  email: 'invited@x.com',
  role: 'member',
  status: 'pending',
  createdAt: new Date('2026-04-01').toISOString(),
};

const RUNTIME_FETCH = global.fetch;

describe('MembersSettingsPage', () => {
  beforeEach(() => {
    routerQuery.current = {};
    replaceMock.mockReset();
    recoverFromForbidden.mockReset();
    // Default recovery outcome so unrelated tests don't crash when the page
    // happens to fire the 403 recovery effect on a stale render.
    recoverFromForbidden.mockResolvedValue({ kind: 'switched', workspaceId: 'ws1' });
    storeState.workspaces = [
      { id: 'ws1', name: 'Speedrun', role: 'owner', status: 'ready' },
    ];
    storeState.currentWorkspaceId = 'ws1';
    global.fetch = RUNTIME_FETCH;
  });

  /* ---------------- skeleton + header + role gating (8.2.1) ---------------- */

  it('redirects to /sign_in on 401', async () => {
    mockSwr({ '/api/auth/me': { error: true, status: 401 } });
    render(<MembersSettingsPage />);
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/sign_in');
    });
  });

  it('renders header strip with seat counts', () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [PENDING_INVITE] } },
    });
    render(<MembersSettingsPage />);
    // "2 members · 1 pending invite"
    expect(screen.getByTestId('members-header-counts')).toHaveTextContent(/2 members/);
    expect(screen.getByTestId('members-header-counts')).toHaveTextContent(/1 pending invite/);
  });

  it('owner role: invite form + pending card + role/remove controls all rendered', () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER, PLAIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [PENDING_INVITE] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.getByTestId('invite-form')).toBeInTheDocument();
    expect(screen.getByTestId('pending-invites-card')).toBeInTheDocument();
    expect(screen.getByTestId('members-card')).toBeInTheDocument();
    // Plain-member row should expose a Remove button (owner can remove).
    expect(screen.getByTestId(`member-remove-${PLAIN_MEMBER.userId}`)).toBeInTheDocument();
  });

  it('member role: invite form, pending card, and management controls all absent', () => {
    // Caller is the plain member.
    mockSwr({
      '/api/auth/me': { data: { id: PLAIN_MEMBER.userId, email: PLAIN_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER, PLAIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-invites-card')).not.toBeInTheDocument();
    // members card still renders, but no remove buttons
    expect(screen.getByTestId('members-card')).toBeInTheDocument();
    expect(screen.queryByTestId(`member-remove-${ADMIN_MEMBER.userId}`)).not.toBeInTheDocument();
  });

  /* ---------------- invite card (8.2.2) ---------------- */

  it('invite form: parses CSV, posts to /api/workspaces/ws1/invites, surfaces failed[]', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sent: 1, failed: [{ email: 'b@x.com', reason: 'already_member' }] }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    const textarea = screen.getByLabelText(/email addresses/i);
    fireEvent.change(textarea, { target: { value: 'a@x.com, b@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invites/i }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/workspaces/ws1/invites');
    const body = JSON.parse(options.body);
    expect(body.emails).toEqual(['a@x.com', 'b@x.com']);
    expect(body.role).toBe('member');
    // Failed row surfaced inline.
    await waitFor(() => {
      expect(screen.getByText(/already_member/)).toBeInTheDocument();
    });
  });

  it('invite form: disables submit when more than 10 emails or any is invalid', () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    const textarea = screen.getByLabelText(/email addresses/i);
    const button = screen.getByRole('button', { name: /send invites/i });
    // Invalid email → disabled.
    fireEvent.change(textarea, { target: { value: 'not-an-email' } });
    expect(button).toBeDisabled();
    // 11 emails → disabled.
    const emails = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(',');
    fireEvent.change(textarea, { target: { value: emails } });
    expect(button).toBeDisabled();
    // 2 valid → enabled.
    fireEvent.change(textarea, { target: { value: 'a@x.com, b@x.com' } });
    expect(button).not.toBeDisabled();
  });

  /* ---------------- pending invites card (8.2.3) ---------------- */

  it('pending invites: Resend button posts to resend endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [PENDING_INVITE] } },
    });
    render(<MembersSettingsPage />);
    fireEvent.click(screen.getByTestId(`invite-resend-${PENDING_INVITE.id}`));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/workspaces/ws1/invites/${PENDING_INVITE.id}/resend`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('pending invites: Revoke opens AlertDialog; confirming posts DELETE', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [PENDING_INVITE] } },
    });
    render(<MembersSettingsPage />);
    // Click the row's Revoke button — this is the AlertDialog trigger.
    fireEvent.click(screen.getByTestId(`invite-revoke-${PENDING_INVITE.id}`));
    // Trigger alone must not fire the destructive request.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Dialog mounts; click the destructive action.
    const confirmBtn = await screen.findByTestId(
      `invite-revoke-confirm-${PENDING_INVITE.id}`,
    );
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/workspaces/ws1/invites/${PENDING_INVITE.id}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('pending invites: cancelling the Revoke AlertDialog does NOT fire DELETE', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [PENDING_INVITE] } },
    });
    render(<MembersSettingsPage />);
    fireEvent.click(screen.getByTestId(`invite-revoke-${PENDING_INVITE.id}`));
    const cancel = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancel);
    // Give any pending microtasks a chance to flush — none should fire fetch.
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /* ---------------- members card (8.2.4) ---------------- */

  it('members card: role dropdown PATCHes the member endpoint with the chosen role', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    const select = screen.getByTestId(`member-role-${ADMIN_MEMBER.userId}`);
    fireEvent.change(select, { target: { value: 'member' } });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/workspaces/ws1/members/${ADMIN_MEMBER.userId}`,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
    expect(body).toEqual({ role: 'member' });
  });

  it('members card: Remove opens AlertDialog; confirming posts DELETE', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, PLAIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    fireEvent.click(screen.getByTestId(`member-remove-${PLAIN_MEMBER.userId}`));
    // Trigger alone must not fire the destructive request.
    expect(fetchSpy).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByTestId(
      `member-remove-confirm-${PLAIN_MEMBER.userId}`,
    );
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/workspaces/ws1/members/${PLAIN_MEMBER.userId}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('members card: cancelling the Remove AlertDialog does NOT fire DELETE', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, PLAIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    fireEvent.click(screen.getByTestId(`member-remove-${PLAIN_MEMBER.userId}`));
    const cancel = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancel);
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('members card: owner row has no role dropdown and no remove button', () => {
    mockSwr({
      '/api/auth/me': { data: { id: ADMIN_MEMBER.userId, email: ADMIN_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    // Caller is admin
    storeState.workspaces = [{ id: 'ws1', name: 'Speedrun', role: 'admin', status: 'ready' }];
    render(<MembersSettingsPage />);
    expect(screen.queryByTestId(`member-role-${OWNER_MEMBER.userId}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`member-remove-${OWNER_MEMBER.userId}`)).not.toBeInTheDocument();
  });

  it('members card: self row has no role dropdown and no remove button', () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER, ADMIN_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.queryByTestId(`member-role-${OWNER_MEMBER.userId}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`member-remove-${OWNER_MEMBER.userId}`)).not.toBeInTheDocument();
  });

  /* ---------------- workspace status handling (8.2.5) ---------------- */

  it('workspace status provisioning: shows badge; invite form still enabled', () => {
    storeState.workspaces = [{ id: 'ws1', name: 'Speedrun', role: 'owner', status: 'provisioning' }];
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.getByTestId('workspace-status-badge')).toHaveTextContent(/provisioning/i);
    expect(screen.getByTestId('invite-form')).toBeInTheDocument();
  });

  it('workspace status failed: shows badge; invite form disabled with copy', () => {
    storeState.workspaces = [{ id: 'ws1', name: 'Speedrun', role: 'owner', status: 'failed' }];
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { data: { members: [OWNER_MEMBER] } },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.getByTestId('workspace-status-badge')).toHaveTextContent(/failed/i);
    const textarea = screen.getByLabelText(/email addresses/i) as HTMLTextAreaElement;
    expect(textarea).toBeDisabled();
  });

  it('workspace deleted (404 from /members): redirects to /', async () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { error: true, status: 404 },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  /* ---------------- access-denied + 403 recovery (8.2.6) ---------------- */

  it('on 403 from /members: renders access-denied empty state, no controls', () => {
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { error: true, status: 403 },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    expect(screen.getByTestId('members-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('members-card')).not.toBeInTheDocument();
  });

  it('on 403: calls useWorkspaceStore.recoverFromForbidden and routes per outcome', async () => {
    recoverFromForbidden.mockResolvedValue({ kind: 'switched', workspaceId: 'ws-next' });
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { error: true, status: 403 },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    await waitFor(() => {
      expect(recoverFromForbidden).toHaveBeenCalled();
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('on 403 with no_workspaces: routes to /auth/onboard', async () => {
    recoverFromForbidden.mockResolvedValue({ kind: 'no_workspaces' });
    mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { error: true, status: 403 },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    await waitFor(() => {
      expect(recoverFromForbidden).toHaveBeenCalled();
      expect(replaceMock).toHaveBeenCalledWith('/auth/onboard');
    });
  });

  it('on 403: drops the cached error on both SWR keys before triggering recovery', async () => {
    // Spec-compliance check: members + invites cached 403 errors must be
    // cleared (mutate(undefined, { revalidate: false })) so a return-trip to
    // /auth/settings/members after recovery doesn't replay the stale failure.
    recoverFromForbidden.mockResolvedValue({ kind: 'switched', workspaceId: 'ws-next' });
    const mutate = mockSwr({
      '/api/auth/me': { data: { id: OWNER_MEMBER.userId, email: OWNER_MEMBER.email } },
      '/api/workspaces/ws1/members': { error: true, status: 403 },
      '/api/workspaces/ws1/invites': { data: { invites: [] } },
    });
    render(<MembersSettingsPage />);
    await waitFor(() => {
      expect(recoverFromForbidden).toHaveBeenCalled();
    });
    // Both members + invites SWR keys share the same mutate spy in this mock.
    // We expect at least two drop-the-cache calls before recovery routed away.
    const dropCalls = mutate.mock.calls.filter(
      (call) => call[0] === undefined && call[1]?.revalidate === false,
    );
    expect(dropCalls.length).toBeGreaterThanOrEqual(2);
  });
});
