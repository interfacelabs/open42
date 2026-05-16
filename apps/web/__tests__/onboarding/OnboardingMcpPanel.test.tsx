import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/onboard',
    asPath: '/onboard',
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

import useSWR from 'swr';
import { OnboardingMcpPanel } from '@/components/onboarding/OnboardingMcpPanel';

function mockSwr(data: unknown) {
  (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data,
    error: null,
    mutate: vi.fn(),
    isLoading: false,
  });
}

describe('OnboardingMcpPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing until the runtime is ready', () => {
    mockSwr(undefined);
    const { container } = render(
      <OnboardingMcpPanel runtime="provisioning" workspaceId="ws-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the compact pitch when runtime is ready', () => {
    mockSwr(undefined);
    render(<OnboardingMcpPanel runtime="ready" workspaceId="ws-1" />);
    expect(screen.getByText(/Use this brain in Claude Code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set up MCP/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Set up later in Settings/i })).toHaveAttribute(
      'href',
      '/settings/mcp',
    );
  });

  it('expands to the manager and disappears on dismiss', () => {
    mockSwr({
      enabled: false,
      available: true,
      issuerUrl: 'https://ws-abc.proxy.open42.ai',
      mcpUrl: 'https://ws-abc.proxy.open42.ai/mcp',
      role: 'owner',
      myClient: null,
      clients: [],
    });
    render(<OnboardingMcpPanel runtime="ready" workspaceId="ws-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Set up MCP/i }));
    expect(screen.getByTestId('mcp-toggle')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Do this later/i }));
    expect(screen.queryByTestId('mcp-toggle')).not.toBeInTheDocument();
    expect(screen.queryByText(/Use this brain in Claude Code/i)).not.toBeInTheDocument();
  });
});
