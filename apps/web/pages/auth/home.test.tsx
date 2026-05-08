import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/auth/home',
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
import HomePage from './home';

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

describe('HomePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('empty: renders source CTAs and editorial empty quote', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mkCurrent({ connections: [], lastJob: null }),
      error: null,
      mutate: vi.fn(),
    });
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /your brain is empty/i })).toBeInTheDocument();
    expect(screen.getByText(/Connect Notion/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Notion zip/i)).toBeInTheDocument();
    // editorial quote
    expect(screen.getByText(/A library is just a building/i)).toBeInTheDocument();
  });

  it('ingesting: renders progress card and ingesting quote', () => {
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
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { name: /reading your team/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/export\.zip/)).toBeInTheDocument();
    // editorial quote
    expect(screen.getByText(/Some answers/i)).toBeInTheDocument();
  });

  it('ready: renders the calm dashboard surface (no editorial copy)', () => {
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
    render(<HomePage />);
    // No editorial empty / ingesting headings
    expect(screen.queryByText(/Your brain is empty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading your team/i)).not.toBeInTheDocument();
    // Calm surface: BrainStatus heading reflects ready state; sidebar nav present.
    expect(
      screen.getByRole('heading', { name: /your brain is ready/i }),
    ).toBeInTheDocument();
    // Sidebar nav links from the calm Sidebar component.
    expect(screen.getByRole('link', { name: /brain status/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /chat/i })).toBeInTheDocument();
  });
});
