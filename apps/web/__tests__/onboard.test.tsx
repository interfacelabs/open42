import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Lets each test override the URL `?step=...` / `?mode=...` query without
// remounting the mock — deriveOnboardStep reads them.
const mocks = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  routerQuery: { current: {} as Record<string, unknown> },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mocks.routerQuery.current;
    },
    replace: mocks.replaceMock,
    push: mocks.pushMock,
    pathname: '/onboard',
  }),
}));

// Back-compat alias used by the existing tests below.
const mockRouterQuery = mocks.routerQuery;

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: vi.fn(),
  };
});

import useSWR from 'swr';
import OnboardPage from '@/pages/onboard';
import { __resetWorkspaceStoreForTests } from '@/lib/workspaces/store';

describe('OnboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.replaceMock.mockReset();
    mocks.pushMock.mockReset();
    mockRouterQuery.current = {};
    __resetWorkspaceStoreForTests();
  });

  it('renders WorkspaceStep when no workspace exists', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: null,
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage />);
    expect(screen.getByRole('heading', { name: /name your brain/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /free/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /paid/i })).toBeInTheDocument();
  });

  it('disables the paid workspace option when upgrades are paused', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: null,
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage billingUpgradesEnabled={false} />);
    expect(screen.getByRole('radio', { name: /paid/i })).toBeDisabled();
    expect(screen.getByText(/Paid upgrades are paused/i)).toBeInTheDocument();
  });

  it('renders InviteStep when ?step=invite', () => {
    mockRouterQuery.current = { step: 'invite' };
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Speedrun', runtime: 'ready' },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage />);
    expect(screen.getByRole('heading', { name: /who else needs this brain/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email addresses/i)).toBeInTheDocument();
  });

  it('renders BillingStep when a workspace requires billing', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: {
          id: 'ws1',
          name: 'Speedrun',
          plan: 'team',
          status: 'billing_required',
          runtime: 'billing_required',
        },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage />);
    expect(screen.getByRole('heading', { name: /confirm the paid plan/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to stripe/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(mocks.pushMock).toHaveBeenCalledWith('/onboard?step=workspace');
  });

  it('disables checkout from the billing step when upgrades are paused', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: {
          id: 'ws1',
          name: 'Speedrun',
          plan: 'team',
          status: 'billing_required',
          runtime: 'billing_required',
        },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage billingUpgradesEnabled={false} />);
    expect(screen.getByRole('button', { name: /upgrades paused/i })).toBeDisabled();
    expect(screen.getByText(/choose the free demo workspace/i)).toBeInTheDocument();
  });

  it('starts provisioning after Stripe returns to onboarding', async () => {
    mockRouterQuery.current = { step: 'billing', checkout: 'success' };
    const mutate = vi.fn();
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: {
          id: 'ws1',
          name: 'Speedrun',
          plan: 'team',
          status: 'billing_required',
          runtime: 'billing_required',
        },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate,
      isLoading: false,
    });
    const fetchMock = makeFetch({
      '/api/workspaces/ws1/billing/provision': {
        ok: true,
        status: 202,
        body: { ok: true, status: 'provisioning' },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/ws1/billing/provision',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mutate).toHaveBeenCalled();
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?step=invite');
    });
  });

  it('shows a loading placeholder while SWR is loading', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: null,
      mutate: vi.fn(),
      isLoading: true,
    });
    render(<OnboardPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders ConnectSourcesStep when ?step=connect and runtime is ready', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Speedrun', runtime: 'ready' },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    // useRouter mock returns query: {} — but deriveOnboardStep falls through
    // to 'connect' when workspace is ready and connections.length === 0,
    // which is exactly this state. So no urlStep needed.
    render(<OnboardPage />);
    expect(screen.getByRole('heading', { name: /where are your docs/i })).toBeInTheDocument();
    expect(screen.getByText(/I already have a GitHub repo/i)).toBeInTheDocument();
    expect(screen.getByText(/I need a GitHub repo/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect Notion/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Notion zip/i)).toBeInTheDocument();
  });

  it('opens GitHub repo creation from the source step', () => {
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Speedrun', runtime: 'ready' },
        connections: [],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });

    render(<OnboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /I need a GitHub repo/i }));

    expect(openMock).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/new'),
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.getByText(/Created the repo/i)).toBeInTheDocument();
  });

  it('sends the selected BYOK Composio profile when connecting Notion', async () => {
    const mutate = vi.fn();
    const swrMock = useSWR as unknown as ReturnType<typeof vi.fn>;
    swrMock.mockImplementation((key: unknown) => {
      if (key === '/api/workspaces/current') {
        return {
          data: {
            workspace: { id: 'ws1', name: 'Speedrun', runtime: 'ready' },
            connections: [],
            lastJob: null,
            invites: [],
            user: { id: 'u', email: 'a@x.com' },
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      if (key === '/api/workspaces/ws1/connector-auth-profiles') {
        return {
          data: {
            profiles: [
              {
                id: 'open42-managed',
                mode: 'open42_managed',
                label: 'Open42 managed Composio',
                services: [{ serviceId: 'notion', configured: true, enabled: true }],
              },
              {
                id: 'profile-byok',
                mode: 'byok',
                label: 'Customer Composio',
                services: [{ serviceId: 'notion', configured: true, enabled: true }],
              },
            ],
          },
          error: null,
          mutate: vi.fn(),
          isLoading: false,
        };
      }
      return { data: undefined, error: null, mutate: vi.fn(), isLoading: false };
    });
    const fetchMock = makeFetch({
      '/api/workspaces/ws1/connections/init': {
        ok: true,
        status: 200,
        body: {},
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /customer composio/i }));
    fireEvent.click(screen.getByRole('button', { name: /connect notion/i }));

    await waitFor(() => {
      const initCall = fetchMock.mock.calls.find(
        (call) => String(call[0]) === '/api/workspaces/ws1/connections/init',
      );
      expect(initCall).toBeTruthy();
      const init = initCall?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toMatchObject({
        kind: 'notion-composio',
        serviceId: 'notion',
        authProfileId: 'profile-byok',
      });
    });
  });
});

/**
 * Build a fetch mock keyed by URL prefix:
 *   - any URL with no entry → 404 { error: 'not_mocked' }
 *   - entries are matched by `startsWith`, longest-prefix first
 */
function makeFetch(routes: Record<string, { ok: boolean; status: number; body: unknown }>) {
  return vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const key = String(url);
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => key.startsWith(k));
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

describe('OnboardPage — mode=create', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.replaceMock.mockReset();
    mocks.pushMock.mockReset();
    mockRouterQuery.current = {};
    __resetWorkspaceStoreForTests();
    if (typeof window !== 'undefined') {
      window.sessionStorage.clear();
    }
  });

  it('shows workspace name step even when user has an existing workspace', () => {
    mockRouterQuery.current = { mode: 'create' };
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
        connections: [{}],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate: vi.fn(),
      isLoading: false,
    });
    render(<OnboardPage />);
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Acme Corp')).toBeInTheDocument();
    expect(screen.queryByText(/Existing/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /name your brain/i })).toBeInTheDocument();
  });

  it('renders workspace step even while SWR is still loading', () => {
    mockRouterQuery.current = { mode: 'create' };
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: null,
      mutate: vi.fn(),
      isLoading: true,
    });
    render(<OnboardPage />);
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
  });

  it('submit POSTs /api/workspaces (not the onboarding alias)', async () => {
    mockRouterQuery.current = { mode: 'create' };
    const mutate = vi.fn();
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
        connections: [{}],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate,
      isLoading: false,
    });
    const fetchMock = makeFetch({
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: { workspace: { id: 'w2', name: 'New', status: 'provisioning' } },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: 'New Brain' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const postCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/workspaces');
    expect(JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      name: 'New Brain',
      plan: 'starter',
    });

    // Should NOT have hit the legacy alias.
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls).not.toContain('/api/workspaces/onboarding/workspace');

    // After success it transitions to the provisioning step (mode=create).
    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?mode=create&step=provisioning');
    });
  });

  it('paid create routes to billing before provisioning', async () => {
    mockRouterQuery.current = { mode: 'create' };
    const mutate = vi.fn();
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
        connections: [{}],
        lastJob: null,
        invites: [],
        user: { id: 'u', email: 'a@x.com' },
      },
      error: null,
      mutate,
      isLoading: false,
    });
    const fetchMock = makeFetch({
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: { workspace: { id: 'w2', name: 'New', status: 'billing_required' } },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: 'New Brain' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /paid/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?mode=create&step=billing');
    });
    const postCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/workspaces');
    expect(JSON.parse(String((postCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      plan: 'team',
    });
  });

  it('on ready, switches via the store and routes to source connection', async () => {
    // Setup: page POSTs /api/workspaces (returns the new id w2). Then we
    // poll /api/workspaces (list endpoint) until the new workspace shows
    // status='ready'. The list reflects the new row, and that's what drives
    // the switch into the new workspace before the source-connection step.
    mockRouterQuery.current = { mode: 'create' };
    const mutate = vi.fn(async () => ({
      workspace: { id: 'w2', name: 'New', runtime: 'ready' },
      connections: [],
      lastJob: null,
      invites: [],
      user: { id: 'u', email: 'a@x.com' },
      requiresProviderKeys: false,
      providerKeys: { anthropicChat: true, openaiEmbed: true },
    }));
    const swrMock = useSWR as unknown as ReturnType<typeof vi.fn>;

    // SWR returns shape based on the key the page passes in. The list
    // endpoint result lives in a ref so we can flip it mid-test from
    // provisioning -> ready without re-rendering manually.
    type ListResult = {
      workspaces: Array<{ id: string; name: string; role: string; status: string }>;
    };
    const listRef: { current: ListResult | undefined } = { current: undefined };
    swrMock.mockImplementation((key: unknown) => {
      if (key === '/api/workspaces/current') {
        return {
          data: {
            // Intentionally still old in the cached current payload; the
            // effect must not use it to decide which workspace became ready.
            workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
            connections: [{}],
            lastJob: null,
            invites: [],
            user: { id: 'u', email: 'a@x.com' },
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      if (key === '/api/workspaces') {
        return { data: listRef.current, error: null, mutate, isLoading: false };
      }
      // Anything else (e.g., null when the create flow hasn't submitted yet)
      return { data: undefined, error: null, mutate, isLoading: false };
    });

    const fetchMock = makeFetch({
      '/api/workspaces/w2/switch': { ok: true, status: 200, body: { ok: true } },
      // POST /api/workspaces returns the new id
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: { workspace: { id: 'w2', name: 'New', status: 'provisioning' } },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { rerender } = render(<OnboardPage />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: 'New' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // POST /api/workspaces fires, then the page sets createdWorkspaceId
    // which activates the second SWR key.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // First poll: still provisioning. The effect bails out because status
    // !== 'ready', so no switch is issued.
    listRef.current = {
      workspaces: [
        { id: 'ws1', name: 'Existing', role: 'owner', status: 'ready' },
        { id: 'w2', name: 'New', role: 'owner', status: 'provisioning' },
      ],
    };
    rerender(<OnboardPage />);
    // Allow microtasks; confirm we did NOT switch yet.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/workspaces/w2/switch', expect.anything());

    // Next poll: status flips to ready. switch + connect-step redirect fire.
    listRef.current = {
      workspaces: [
        { id: 'ws1', name: 'Existing', role: 'owner', status: 'ready' },
        { id: 'w2', name: 'New', role: 'owner', status: 'ready' },
      ],
    };
    rerender(<OnboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w2/switch',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?step=connect');
    });
  });

  it('on ready, routes to provider keys before sources when BYOK is missing', async () => {
    window.sessionStorage.setItem('open42:create_pending_workspace_id', 'w2');
    mockRouterQuery.current = { mode: 'create', step: 'provisioning' };
    const mutate = vi.fn(async () => ({
      workspace: { id: 'w2', name: 'New', runtime: 'ready' },
      connections: [],
      lastJob: null,
      invites: [],
      user: { id: 'u', email: 'a@x.com' },
      requiresProviderKeys: true,
      providerKeys: { anthropicChat: true, openaiEmbed: false },
    }));
    const swrMock = useSWR as unknown as ReturnType<typeof vi.fn>;
    swrMock.mockImplementation((key: unknown) => {
      if (key === '/api/workspaces/current') {
        return {
          data: {
            workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
            connections: [{}],
            lastJob: null,
            invites: [],
            user: { id: 'u', email: 'a@x.com' },
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      if (key === '/api/workspaces') {
        return {
          data: {
            workspaces: [
              { id: 'ws1', name: 'Existing', role: 'owner', status: 'ready' },
              { id: 'w2', name: 'New', role: 'owner', status: 'ready' },
            ],
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      return { data: undefined, error: null, mutate, isLoading: false };
    });

    const fetchMock = makeFetch({
      '/api/workspaces/w2/switch': { ok: true, status: 200, body: { ok: true } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w2/switch',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?step=keys');
    });
  });

  it('on failed, switches into the failed workspace and does NOT redirect to /', async () => {
    // Round-5 P2: previously the mode=create polling effect only fired on
    // status='ready'. If provisioning failed mid-poll the user got stuck on
    // the provisioning spinner forever — no retry UI, no error. Now the
    // effect should switch into the failed workspace so the ProvisioningStep
    // surfaces its failure/retry UI (driven by /workspaces/current.runtime).
    mockRouterQuery.current = { mode: 'create' };
    const mutate = vi.fn();
    const swrMock = useSWR as unknown as ReturnType<typeof vi.fn>;

    type ListResult = {
      workspaces: Array<{ id: string; name: string; role: string; status: string }>;
    };
    const listRef: { current: ListResult | undefined } = { current: undefined };
    swrMock.mockImplementation((key: unknown) => {
      if (key === '/api/workspaces/current') {
        return {
          data: {
            workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
            connections: [{}],
            lastJob: null,
            invites: [],
            user: { id: 'u', email: 'a@x.com' },
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      if (key === '/api/workspaces') {
        return { data: listRef.current, error: null, mutate, isLoading: false };
      }
      return { data: undefined, error: null, mutate, isLoading: false };
    });

    const fetchMock = makeFetch({
      '/api/workspaces/w2/switch': { ok: true, status: 200, body: { ok: true } },
      '/api/workspaces': {
        ok: true,
        status: 200,
        body: { workspace: { id: 'w2', name: 'New', status: 'provisioning' } },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { rerender } = render(<OnboardPage />);
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: 'New' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // The polled list reports the new workspace as 'failed' — the effect
    // should switch into it (so the failure UI binds correctly) but NOT
    // redirect home.
    listRef.current = {
      workspaces: [
        { id: 'ws1', name: 'Existing', role: 'owner', status: 'ready' },
        { id: 'w2', name: 'New', role: 'owner', status: 'failed' },
      ],
    };
    rerender(<OnboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w2/switch',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Should not redirect home for a failed workspace — user stays on the
    // provisioning step with the retry UI available.
    expect(mocks.replaceMock).not.toHaveBeenCalledWith('/');
  });

  it('mode=create: createdWorkspaceId is read from sessionStorage on mount', async () => {
    // Codex round-6 P2: reload during provisioning previously reset the
    // React-only createdWorkspaceId state to null, the list poll never
    // armed, and the spinner hung forever. Seeding sessionStorage and
    // mounting should reactivate the list poll for the stashed id.
    window.sessionStorage.setItem('open42:create_pending_workspace_id', 'w2');
    mockRouterQuery.current = { mode: 'create', step: 'provisioning' };
    const mutate = vi.fn(async () => ({
      workspace: { id: 'w2', name: 'New', runtime: 'ready' },
      connections: [],
      lastJob: null,
      invites: [],
      user: { id: 'u', email: 'a@x.com' },
      requiresProviderKeys: false,
      providerKeys: { anthropicChat: true, openaiEmbed: true },
    }));
    const swrMock = useSWR as unknown as ReturnType<typeof vi.fn>;
    type ListResult = {
      workspaces: Array<{ id: string; name: string; role: string; status: string }>;
    };
    const listRef: { current: ListResult | undefined } = {
      current: {
        workspaces: [
          { id: 'ws1', name: 'Existing', role: 'owner', status: 'ready' },
          { id: 'w2', name: 'New', role: 'owner', status: 'ready' },
        ],
      },
    };
    const seenKeys: unknown[] = [];
    swrMock.mockImplementation((key: unknown) => {
      seenKeys.push(key);
      if (key === '/api/workspaces/current') {
        return {
          data: {
            workspace: { id: 'ws1', name: 'Existing', runtime: 'ready' },
            connections: [{}],
            lastJob: null,
            invites: [],
            user: { id: 'u', email: 'a@x.com' },
          },
          error: null,
          mutate,
          isLoading: false,
        };
      }
      if (key === '/api/workspaces') {
        return { data: listRef.current, error: null, mutate, isLoading: false };
      }
      return { data: undefined, error: null, mutate, isLoading: false };
    });

    const fetchMock = makeFetch({
      '/api/workspaces/w2/switch': { ok: true, status: 200, body: { ok: true } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardPage />);

    // On mount, the page restored createdWorkspaceId='w2' from
    // sessionStorage, which arms the second SWR key ('/api/workspaces').
    expect(seenKeys).toContain('/api/workspaces');

    // Polling sees the new workspace as 'ready' → switch + source handoff
    // without the user ever re-submitting the workspace form.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/w2/switch',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mocks.replaceMock).toHaveBeenCalledWith('/onboard?step=connect');
    });

    // And the stash is cleared after resolution so a future visit doesn't
    // re-arm against a stale id.
    expect(window.sessionStorage.getItem('open42:create_pending_workspace_id')).toBeNull();
  });
});
