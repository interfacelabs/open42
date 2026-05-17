import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, findAllByLabelText, waitFor } from '@testing-library/react';

import SignInPage from '@/pages/sign_in';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: mocks.replace,
    pathname: '/sign_in',
  }),
}));

vi.mock('swr', () => ({
  mutate: mocks.mutate,
}));

describe('SignInPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.replace.mockReset();
    mocks.mutate.mockReset();
    mocks.mutate.mockResolvedValue(undefined);
  });

  it('renders editorial split-pane with email entry', () => {
    const { getByLabelText, getByText } = render(<SignInPage />);
    expect(getByLabelText(/email/i)).toBeInTheDocument();
    expect(getByText(/A brain/i)).toBeInTheDocument();
  });

  it('switches to code-entry after submitting email', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    }) as unknown as typeof fetch;
    const { getByLabelText, getByRole, container } = render(<SignInPage />);
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(getByRole('button', { name: /continue/i }));
    const boxes = await findAllByLabelText(container, /digit \d of 6/i);
    expect(boxes).toHaveLength(6);
  });

  it('clears stale auth cache before redirecting after OTP verification', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, redirectTo: '/onboard' }),
      }) as unknown as typeof fetch;

    const { getByLabelText, getByRole, container } = render(<SignInPage />);
    fireEvent.change(getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(getByRole('button', { name: /continue/i }));

    const boxes = await findAllByLabelText(container, /digit \d of 6/i);
    const firstBox = boxes[0];
    expect(firstBox).toBeDefined();
    fireEvent.paste(firstBox!, {
      clipboardData: {
        getData: () => '123456',
      },
    });

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/onboard'));
    expect(mocks.mutate).toHaveBeenCalledWith('/api/auth/me', undefined, {
      revalidate: false,
    });
    expect(mocks.mutate).toHaveBeenCalledWith('/api/workspaces', undefined, {
      revalidate: false,
    });
    expect(mocks.mutate).toHaveBeenCalledWith('/api/workspaces/current', undefined, {
      revalidate: false,
    });
  });
});
