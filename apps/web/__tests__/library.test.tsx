import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: { c: 'most-cited' },
    replace: vi.fn(),
    push: vi.fn(),
    asPath: '/library?c=most-cited',
    pathname: '/library',
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    default: vi.fn(),
  };
});

// The page now builds its library SWR key off the current workspace id from
// the Zustand store. Stub the store so the URL is deterministic and the
// hydrate hook is a no-op (we don't want the test to fire real fetches).
const MOCK_WORKSPACE_STATE = {
  workspaces: [{ id: 'ws1', name: 'Speedrun', role: 'owner', status: 'ready' }],
  currentWorkspaceId: 'ws1' as string | null,
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
import LibraryPage from '@/pages/library';
import type { LibraryDoc } from '@/lib/library-types';

const mockSWR = useSWR as unknown as ReturnType<typeof vi.fn>;

const FIXTURE_DOCS: LibraryDoc[] = [
  {
    id: 'refund-policy-v3',
    title: 'Refund policy v3.md',
    source: 'notion',
    lastModifiedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    tags: ['policy', 'billing'],
    citationCount: 14,
    snippet:
      'Annual plans are refundable pro-rated within 30 days of renewal.',
  },
  {
    id: 'billing-faq',
    title: 'Billing FAQ',
    source: 'notion',
    lastModifiedAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    tags: ['billing'],
    citationCount: 9,
    snippet: 'Common questions about billing windows.',
  },
];

describe('LibraryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSWR.mockReset();
    // Both useSWR call sites resolve through the same mock; the page handles
    // missing fields gracefully so a single response shape is enough.
    mockSWR.mockImplementation((key: unknown) => {
      if (
        typeof key === 'string' &&
        key.startsWith('/api/workspaces/ws1/library')
      ) {
        return {
          data: { docs: FIXTURE_DOCS },
          error: null,
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      return {
        data: {
          workspace: { id: 'ws1', name: 'Speedrun' },
          connections: [
            {
              id: 'c1',
              kind: 'notion-composio',
              displayName: 'Notion',
              status: 'active',
            },
          ],
        },
        error: null,
        isLoading: false,
        mutate: vi.fn(),
      };
    });
  });

  it('renders the chosen collection name as the page heading', () => {
    render(<LibraryPage />);
    expect(
      screen.getByRole('heading', { name: /most cited/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ranked by citation count across asks/i),
    ).toBeInTheDocument();
  });

  it('renders each mock doc as a clickable card with citation count', () => {
    render(<LibraryPage />);
    const card = screen.getByRole('button', { name: /Refund policy v3/i });
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('14 cites');
  });

  it('shows the source filter chips', () => {
    render(<LibraryPage />);
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^notion$/i }),
    ).toBeInTheDocument();
  });
});
