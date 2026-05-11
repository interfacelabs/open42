/**
 * Dashboard tests for `/` (was `/` pre-rework).
 *
 * The "your brain is empty" connect-source UI used to live here; it moved
 * to /onboard?step=connect. The dashboard now only handles `ingesting`
 * and `ready` (calm) states. Anything else triggers a redirect via effect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/',
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
import DashboardPage from '@/pages/index';

const mkCurrent = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u', email: 'a@x.com' },
  workspace: {
    id: 'ws1',
    name: 'Speedrun',
    runtime: 'ready' as const,
    status: 'ready',
    plan: null,
    gbrainReady: true,
    createdAt: new Date().toISOString(),
  },
  invites: [],
  connections: [],
  lastJob: null,
  ...overrides,
});

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ingesting: renders progress card', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mkCurrent({
        connections: [
          {
            id: 'c1',
            kind: 'notion-zip',
            status: 'connected',
            displayName: 'export.zip',
          },
        ],
        lastJob: {
          id: 'j1',
          status: 'running',
          pagesTotal: 100,
          createdAt: new Date().toISOString(),
        },
      }),
      error: null,
      mutate: vi.fn(),
    });
    render(<DashboardPage />);
    expect(
      screen.getByRole('heading', { name: /reading your team/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/export\.zip/)).toBeInTheDocument();
  });

  it('ready: renders the ask-first landing', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mkCurrent({
        connections: [
          {
            id: 'c1',
            kind: 'notion-zip',
            status: 'connected',
            displayName: 'export.zip',
          },
        ],
        lastJob: {
          id: 'j1',
          status: 'completed',
          pagesTotal: 247,
          createdAt: new Date().toISOString(),
        },
      }),
      error: null,
      mutate: vi.fn(),
    });
    render(<DashboardPage />);
    // No connect-source / ingesting headings — those live elsewhere now.
    expect(screen.queryByText(/Your brain is empty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading your team/i)).not.toBeInTheDocument();
    // Ask-first hero: prompt, tagline, suggestions.
    expect(
      screen.getByRole('heading', { name: /ask the brain/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/every answer cites its source/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/what does the brain know about/i),
    ).toBeInTheDocument();
    // Sidebar IA: Status section + connected source surface.
    expect(screen.getByRole('link', { name: /^status$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new thread/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /export\.zip/ })).toBeInTheDocument();
  });

  it('ready with no sources: still renders ask-first (post-skip dashboard)', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mkCurrent({ connections: [], lastJob: null }),
      error: null,
      mutate: vi.fn(),
    });
    render(<DashboardPage />);
    // User skipped the connect step in onboarding — they still see the chat.
    expect(
      screen.getByRole('heading', { name: /ask the brain/i }),
    ).toBeInTheDocument();
  });
});
