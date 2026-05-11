import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Lets each test override the URL `?step=...` query without remounting the
// mock — deriveOnboardStep reads it.
const mockRouterQuery: { current: Record<string, unknown> } = { current: {} };
vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mockRouterQuery.current;
    },
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/onboard',
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: vi.fn(),
  };
});

import useSWR from 'swr';
import OnboardPage from '@/pages/onboard';

describe('OnboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRouterQuery.current = {};
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
    expect(
      screen.getByRole('heading', { name: /who else needs this brain/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email addresses/i)).toBeInTheDocument();
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
    expect(
      screen.getByRole('heading', { name: /your brain is empty/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Connect Notion/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Notion zip/i)).toBeInTheDocument();
  });
});
