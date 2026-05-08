import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const replaceMock = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: { invite_id: 'abc', token_hash: 'xyz', type: 'invite' },
    replace: replaceMock,
    pathname: '/auth/invite/accept',
  }),
}));

import AcceptInvitePage from './accept';

describe('AcceptInvitePage', () => {
  it('renders verifying state on mount', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    expect(screen.getByText(/Checking/i)).toBeInTheDocument();
  });

  it('renders expired state when API returns invite_expired', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invite_expired' }),
    }) as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/has expired/i)).toBeInTheDocument();
    });
  });

  it('renders blocked state when user already has workspace', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'invite_blocked',
        reason: 'user_already_has_workspace',
      }),
    }) as unknown as typeof fetch;
    render(<AcceptInvitePage />);
    await waitFor(() => {
      expect(screen.getByText(/already have/i)).toBeInTheDocument();
    });
  });
});
