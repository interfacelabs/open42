import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  routerQuery: { current: {} as Record<string, unknown> },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    get query() {
      return mocks.routerQuery.current;
    },
    replace: mocks.replaceMock,
    pathname: '/connections/github/callback',
  }),
}));

vi.mock('@/lib/csrf', () => ({
  csrfHeaders: () => ({ 'X-CSRF-Token': 'test-csrf' }),
}));

import GitHubCallbackPage from '@/pages/connections/github/callback';

function makeStateToken(payload: Record<string, unknown>, hmac = 'fake-hmac'): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${hmac}`;
}

describe('GitHubCallbackPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.replaceMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks all-repositories installations and links to GitHub settings', async () => {
    const stateToken = makeStateToken({ workspaceId: 'ws-1' });
    mocks.routerQuery.current = {
      state: stateToken,
      installation_id: '123',
    };
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'github_selected_repositories_required',
          configureUrl: 'https://github.com/organizations/acme/settings/installations/123',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<GitHubCallbackPage />);

    expect(await screen.findByText('Select specific repositories in GitHub.')).toBeInTheDocument();
    expect(screen.getByText(/Open42 requires selected repository access/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open GitHub settings/i })).toHaveAttribute(
      'href',
      'https://github.com/organizations/acme/settings/installations/123',
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/connections/github/finalize',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ state: stateToken, installationId: '123' }),
        }),
      );
    });
  });

  it('can retry after the user changes the installation to selected repositories', async () => {
    const stateToken = makeStateToken({ workspaceId: 'ws-1' });
    mocks.routerQuery.current = {
      state: stateToken,
      installation_id: '123',
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'github_selected_repositories_required',
            configureUrl: 'https://github.com/organizations/acme/settings/installations/123',
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            repositories: [
              {
                id: 'repo-1',
                name: 'company-brain',
                fullName: 'acme/company-brain',
                owner: 'acme',
                private: true,
                defaultBranch: 'main',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    render(<GitHubCallbackPage />);

    const retryButton = await screen.findByRole('button', {
      name: /Retry after selecting repos/i,
    });
    fireEvent.click(retryButton);

    expect(await screen.findByText('acme/company-brain')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
