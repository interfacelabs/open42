import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/auth/onboard',
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
import OnboardPage from '@/pages/auth/onboard';

describe('OnboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('renders InviteStep when workspace exists', () => {
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
});
