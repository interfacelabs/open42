import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: routerMocks.replace,
    push: routerMocks.push,
    pathname: '/settings/mcp',
    asPath: '/settings/mcp',
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

const MOCK_WORKSPACE_STATE = {
  workspaces: [{ id: 'ws-test-1', name: 'Test', role: 'owner', status: 'ready' as const }],
  currentWorkspaceId: 'ws-test-1' as string | null,
  loading: false,
  lastError: null as string | null,
  refresh: async () => undefined,
  switchTo: async () => undefined,
  recoverFromForbidden: async () => ({ kind: 'no_workspaces' as const }),
};
vi.mock('@/lib/workspaces/store', () => ({
  useWorkspaceStore: (selector?: (s: typeof MOCK_WORKSPACE_STATE) => unknown) =>
    typeof selector === 'function' ? selector(MOCK_WORKSPACE_STATE) : MOCK_WORKSPACE_STATE,
  useHydrateWorkspaceStore: () => undefined,
}));

import useSWR from 'swr';
import McpSettingsPage from '@/pages/settings/mcp';

const STATUS_PATH = '/api/workspaces/ws-test-1/mcp-proxy';
const CLIENTS_PATH = '/api/workspaces/ws-test-1/mcp-proxy/clients';

interface MockClient {
  id: string;
  label: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface MockStatus {
  enabled: boolean;
  available: boolean;
  issuerUrl: string | null;
  mcpUrl: string | null;
  role?: 'owner' | 'admin' | 'member';
  myClient?: MockClient | null;
  clients: MockClient[];
}

function mockSwr(data: MockStatus | undefined, errorStatus?: number) {
  const mutate = vi.fn();
  if (errorStatus !== undefined) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = errorStatus;
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: err,
      mutate,
      isLoading: false,
    });
  } else {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data,
      error: null,
      mutate,
      isLoading: data === undefined,
    });
  }
  return mutate;
}

const READY_STATUS: MockStatus = {
  enabled: true,
  available: true,
  issuerUrl: 'https://ws-abc.proxy.open42.ai',
  mcpUrl: 'https://ws-abc.proxy.open42.ai/mcp',
  role: 'owner',
  myClient: null,
  clients: [
    {
      id: 'client-1',
      label: 'Claude Code',
      scopes: 'read',
      createdAt: new Date('2026-05-15').toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    },
  ],
};

describe('McpSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerMocks.replace.mockClear();
    routerMocks.push.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page chrome and endpoints when the proxy is enabled', () => {
    mockSwr(READY_STATUS);
    render(<McpSettingsPage />);
    expect(screen.getByRole('heading', { name: 'MCP' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /MCP endpoints/i })).toBeInTheDocument();
    expect(screen.getByText('https://ws-abc.proxy.open42.ai/mcp')).toBeInTheDocument();
    expect(screen.getByText('https://ws-abc.proxy.open42.ai/token')).toBeInTheDocument();
    expect(screen.getByText('https://ws-abc.proxy.open42.ai')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /MCP client Claude Code/i })).toBeInTheDocument();
  });

  it('shows the disabled state with a toggle when the proxy is off', async () => {
    mockSwr({ ...READY_STATUS, enabled: false });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ...READY_STATUS, enabled: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    render(<McpSettingsPage />);

    const toggle = screen.getByTestId('mcp-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Turn it on to issue credentials/i)).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(STATUS_PATH);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ enabled: true });
  });

  it('shows a configuration-disabled banner when available=false', () => {
    mockSwr({
      enabled: false,
      available: false,
      issuerUrl: null,
      mcpUrl: null,
      clients: [],
    });
    render(<McpSettingsPage />);
    expect(screen.getByText(/isn’t configured/i)).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-toggle')).not.toBeInTheDocument();
  });

  it('renders an inline forbidden message when GET returns 403', () => {
    mockSwr(undefined, 403);
    render(<McpSettingsPage />);
    expect(screen.getByTestId('mcp-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-toggle')).not.toBeInTheDocument();
  });

  it('redirects to sign in when MCP settings return 401', async () => {
    mockSwr(undefined, 401);
    render(<McpSettingsPage />);

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith('/sign_in');
    });
  });

  it('creates a client and renders the one-time credentials panel exactly once', async () => {
    const mutate = mockSwr(READY_STATUS);
    const createdSecret = 'gbrain-secret-only-once';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          client: {
            id: 'client-2',
            label: 'Cursor',
            scopes: 'read',
            createdAt: new Date('2026-05-16').toISOString(),
            lastUsedAt: null,
            revokedAt: null,
          },
          clientId: 'cid-2',
          clientSecret: createdSecret,
          scope: 'read',
          grantType: 'client_credentials',
          issuerUrl: 'https://ws-abc.proxy.open42.ai',
          tokenUrl: 'https://ws-abc.proxy.open42.ai/token',
          mcpUrl: 'https://ws-abc.proxy.open42.ai/mcp',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<McpSettingsPage />);

    fireEvent.click(screen.getByTestId('mcp-open-create'));
    const nameInput = screen.getByPlaceholderText(/Claude Code/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Cursor' } });
    fireEvent.click(screen.getByRole('button', { name: /Create client/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(CLIENTS_PATH);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: 'Cursor',
      scope: 'read',
    });

    await waitFor(() => {
      expect(screen.getByTestId('mcp-credentials-panel')).toBeInTheDocument();
    });
    expect(screen.getByText(createdSecret)).toBeInTheDocument();
    expect(mutate).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /I.+ve stored it/i }));
    expect(screen.queryByTestId('mcp-credentials-panel')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(createdSecret);
  });

  it('shows the member self-claim card when the caller is a member with no client', () => {
    mockSwr({
      ...READY_STATUS,
      role: 'member',
      myClient: null,
      clients: [],
    });
    render(<McpSettingsPage />);

    // Member should not see the toggle.
    expect(screen.queryByTestId('mcp-toggle')).not.toBeInTheDocument();
    // Self-claim card surfaces the primary action.
    expect(screen.getByTestId('mcp-member-section')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-claim-self')).toBeInTheDocument();
    expect(screen.getByText(/Claim your personal MCP credentials/i)).toBeInTheDocument();
    // Admin-only "Create client" affordance must not appear for members.
    expect(screen.queryByTestId('mcp-open-create')).not.toBeInTheDocument();
  });

  it('POSTs to /clients/self when the member claims credentials', async () => {
    mockSwr({
      ...READY_STATUS,
      role: 'member',
      myClient: null,
      clients: [],
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          client: {
            id: 'client-member',
            label: 'Personal — alice@example.com',
            scopes: 'read write',
            createdAt: new Date('2026-05-16').toISOString(),
            lastUsedAt: null,
            revokedAt: null,
          },
          clientId: 'gbrain-self',
          clientSecret: 'one-time-secret',
          scope: 'read write',
          grantType: 'client_credentials',
          issuerUrl: 'https://ws-abc.proxy.open42.ai',
          tokenUrl: 'https://ws-abc.proxy.open42.ai/token',
          mcpUrl: 'https://ws-abc.proxy.open42.ai/mcp',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<McpSettingsPage />);

    fireEvent.click(screen.getByTestId('mcp-claim-self'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${CLIENTS_PATH}/self`);
    expect((init as RequestInit).method).toBe('POST');

    await waitFor(() => {
      expect(screen.getByTestId('mcp-credentials-panel')).toBeInTheDocument();
    });
    expect(screen.getByText('one-time-secret')).toBeInTheDocument();
  });

  it('shows the existing client (no claim CTA) when a member already has one', () => {
    mockSwr({
      ...READY_STATUS,
      role: 'member',
      myClient: {
        id: 'client-member',
        label: 'Personal — alice@example.com',
        scopes: 'read write',
        createdAt: new Date('2026-05-15').toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      },
      clients: [
        {
          id: 'client-member',
          label: 'Personal — alice@example.com',
          scopes: 'read write',
          createdAt: new Date('2026-05-15').toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    });
    render(<McpSettingsPage />);
    expect(screen.queryByTestId('mcp-claim-self')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /MCP client Personal — alice@example.com/i }),
    ).toBeInTheDocument();
  });

  it('revokes a client and refreshes the list', async () => {
    const mutate = mockSwr(READY_STATUS);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<McpSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Revoke Claude Code/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${CLIENTS_PATH}/client-1`);
    expect((init as RequestInit).method).toBe('DELETE');
    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });
});
