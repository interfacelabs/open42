import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, findAllByLabelText } from '@testing-library/react';

import SignInPage from './sign_in';

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    replace: vi.fn(),
    pathname: '/sign_in',
  }),
}));

describe('SignInPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
