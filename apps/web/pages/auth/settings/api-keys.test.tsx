import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    push: vi.fn(),
    pathname: '/auth/settings/api-keys',
  }),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return { ...actual, default: vi.fn() };
});

import useSWR from 'swr';
import ApiKeysSettingsPage from './api-keys';

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
    expect(url).toBe('/api/workspaces/credentials');
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
    expect(url).toBe('/api/workspaces/credentials');
    expect((init as RequestInit).method).toBe('DELETE');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({ provider: 'openai', scope: 'chat' });

    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });
});
