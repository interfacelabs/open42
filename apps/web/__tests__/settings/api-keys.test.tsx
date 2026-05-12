import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/settings/api-keys',
    asPath: '/settings/api-keys',
    events: { on: () => {}, off: () => {} },
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

// The page reads the current workspace id from the Zustand store. Tests stub
// it with a fixed id so URL assertions can pin the workspace-scoped path. The
// store hook is also called both with and without a selector (selector form
// from the page, no-arg form from WorkspaceSwitcher/Sidebar) — mock both.
// `useHydrateWorkspaceStore` is a no-op so the test doesn't trigger live
// fetches against the workspace list.
const MOCK_WORKSPACE_STATE = {
  workspaces: [{ id: 'ws-test-1', name: 'Test', role: 'owner', status: 'ready' }],
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
import ApiKeysSettingsPage from '@/pages/settings/api-keys';

const WORKSPACE_PATH = '/api/workspaces/ws-test-1/credentials';

interface MockCredential {
  provider: 'openai' | 'anthropic';
  scope: 'chat' | 'embed';
  model?: string | null;
  createdAt: string;
}

function mockSwr(credentials: MockCredential[]) {
  const mutate = vi.fn();
  (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { credentials },
    error: null,
    mutate,
  });
  return mutate;
}

function mockSwrError(status: number) {
  const mutate = vi.fn();
  const err = new Error('fetch_failed') as Error & { status?: number };
  err.status = status;
  (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: undefined,
    error: err,
    mutate,
  });
  return mutate;
}

describe('ApiKeysSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no credentials are configured', () => {
    mockSwr([]);
    render(<ApiKeysSettingsPage />);
    expect(screen.getByText(/No keys yet\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Add your provider keys below/i),
    ).toBeInTheDocument();
  });

  it('renders a card for each configured credential', () => {
    mockSwr([
      {
        provider: 'openai',
        scope: 'chat',
        model: 'gpt-4o-mini',
        createdAt: new Date('2026-05-01').toISOString(),
      },
      {
        provider: 'openai',
        scope: 'embed',
        model: null,
        createdAt: new Date('2026-05-02').toISOString(),
      },
    ]);
    render(<ApiKeysSettingsPage />);
    expect(
      screen.getByRole('region', { name: /OpenAI Chat credential/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /OpenAI Embed credential/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/gpt-4o-mini/)).toBeInTheDocument();
    // Both cards should display the "Configured" status badge.
    // Use exact match to avoid matching the "Configured keys" section header.
    expect(screen.getAllByText('Configured').length).toBe(2);
  });

  it('disables Save when (provider, scope) is (anthropic, embed)', () => {
    mockSwr([]);
    render(<ApiKeysSettingsPage />);

    const providerSelect = screen.getByRole('combobox', {
      name: /Provider/i,
    }) as HTMLSelectElement;
    const scopeSelect = screen.getByRole('combobox', {
      name: /Scope/i,
    }) as HTMLSelectElement;

    fireEvent.change(providerSelect, { target: { value: 'anthropic' } });
    fireEvent.change(scopeSelect, { target: { value: 'embed' } });

    // Even with an API key entered, the unsupported combo blocks Save.
    const apiKeyInput = screen.getByPlaceholderText(/sk-/);
    fireEvent.change(apiKeyInput, { target: { value: 'sk-ant-xxx' } });

    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
    expect(
      screen.getByText(/doesn.+expose an embeddings API/i),
    ).toBeInTheDocument();
  });

  it('POSTs the right body when Save is clicked', async () => {
    const mutate = mockSwr([]);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, source: 'tenant' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    render(<ApiKeysSettingsPage />);

    const apiKeyInput = screen.getByPlaceholderText(/sk-/) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test-123' } });

    const modelInput = screen.getByPlaceholderText(/gpt-4o-mini/);
    fireEvent.change(modelInput, { target: { value: 'gpt-4o' } });

    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(WORKSPACE_PATH);
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
    });

    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });

  it('DELETEs and refreshes the list when Remove is clicked', async () => {
    const mutate = mockSwr([
      {
        provider: 'openai',
        scope: 'chat',
        model: null,
        createdAt: new Date('2026-05-01').toISOString(),
      },
    ]);

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    render(<ApiKeysSettingsPage />);

    const removeBtn = screen.getByRole('button', {
      name: /Remove OpenAI Chat credential/i,
    });
    fireEvent.click(removeBtn);

    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(WORKSPACE_PATH);
    expect((init as RequestInit).method).toBe('DELETE');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({ provider: 'openai', scope: 'chat' });

    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });

  it('clears the API key input after a successful Save (secret never lingers in the DOM)', async () => {
    mockSwr([]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, source: 'tenant' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<ApiKeysSettingsPage />);

    const apiKeyInput = screen.getByPlaceholderText(/sk-/) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'sk-secret-do-not-leak' } });
    expect(apiKeyInput.value).toBe('sk-secret-do-not-leak');

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      // After save, the input must be cleared so the secret doesn't sit in the
      // DOM where a screen reader, browser extension, or autofill could pick it up.
      expect(apiKeyInput.value).toBe('');
    });

    // The secret string MUST NOT appear anywhere else in the rendered tree
    // (cards show only "Configured" + model + date).
    expect(document.body.innerHTML).not.toContain('sk-secret-do-not-leak');
  });

  it('Remove confirm copy explains the consequence (fall back to shared key)', () => {
    mockSwr([
      {
        provider: 'openai',
        scope: 'chat',
        model: null,
        createdAt: new Date('2026-05-01').toISOString(),
      },
    ]);

    let confirmedMessage = '';
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation((msg) => {
        confirmedMessage = String(msg ?? '');
        return false; // cancel; we just want to inspect the message
      });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(<ApiKeysSettingsPage />);

    fireEvent.click(
      screen.getByRole('button', { name: /Remove OpenAI Chat credential/i }),
    );

    expect(confirmSpy).toHaveBeenCalled();
    expect(confirmedMessage).toMatch(/shared|fall.?back/i);
    // Cancelling the confirm MUST NOT fire the DELETE.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders an inline forbidden message when GET returns 403 (non-owner viewing the page)', () => {
    mockSwrError(403);

    render(<ApiKeysSettingsPage />);

    const banner = screen.getByTestId('api-keys-forbidden');
    expect(banner).toHaveTextContent(/Only workspace owners can manage/i);
    // Form and list are NOT rendered for forbidden users.
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Configured keys/i)).not.toBeInTheDocument();
  });
});
