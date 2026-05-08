import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    pathname: '/auth/settings/plan',
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

import useSWR from 'swr';
import PlanSettingsPage from './plan';

describe('PlanSettingsPage', () => {
  beforeEach(() => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        user: { id: 'u', email: 'a@x.com' },
        workspace: {
          id: 'ws1',
          name: 'Speedrun',
          runtime: 'ready',
          status: 'ready',
          plan: null,
          gbrainReady: true,
          createdAt: new Date().toISOString(),
        },
        invites: [],
        connections: [],
        lastJob: null,
      },
      error: null,
      mutate: vi.fn(),
    });
  });

  it('renders three plan cards', () => {
    render(<PlanSettingsPage />);
    expect(screen.getByText(/Free/i)).toBeInTheDocument();
    expect(screen.getByText(/Team/i)).toBeInTheDocument();
    expect(screen.getByText(/Business/i)).toBeInTheDocument();
  });

  it('marks Free as current plan', () => {
    render(<PlanSettingsPage />);
    expect(screen.getByText(/Current plan/i)).toBeInTheDocument();
  });

  it('marks Team and Business as Coming soon', () => {
    render(<PlanSettingsPage />);
    const comingSoonElements = screen.getAllByText(/Coming soon/i);
    expect(comingSoonElements.length).toBe(2);
  });
});
