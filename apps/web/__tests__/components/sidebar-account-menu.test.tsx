import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storeState: {
    workspaces: [{ id: 'w1', name: 'Acme', role: 'owner', status: 'ready' }],
    currentWorkspaceId: 'w1',
  },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/',
    asPath: '/',
    push: vi.fn(),
    events: { on: () => undefined, off: () => undefined },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/workspaces/current') {
      return {
        data: { user: { id: 'u1', email: 'owner@open42.test' }, connections: [] },
      };
    }
    return { data: { skills: [] } };
  },
}));

vi.mock('@/lib/workspaces/store', () => ({
  useHydrateWorkspaceStore: () => undefined,
  useWorkspaceStore: (selector?: (state: typeof mocks.storeState) => unknown) =>
    selector ? selector(mocks.storeState) : mocks.storeState,
}));

import { Sidebar } from '@/components/Sidebar';

describe('Sidebar account menu', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_OPEN42_EDITION = 'cloud';
    mocks.storeState.workspaces = [
      { id: 'w1', name: 'Acme', role: 'owner', status: 'ready' },
    ];
    mocks.storeState.currentWorkspaceId = 'w1';
  });

  it('opens account and privileged workspace links for owners', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: /owner/i }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /account settings/i })).toHaveAttribute(
      'href',
      '/settings/account',
    );
    expect(screen.getByRole('menuitem', { name: /billing/i })).toHaveAttribute(
      'href',
      '/settings/plan',
    );
    expect(screen.getByRole('menuitem', { name: /manage users/i })).toHaveAttribute(
      'href',
      '/settings/members',
    );
    expect(screen.getByRole('menuitem', { name: /chat byok/i })).toHaveAttribute(
      'href',
      '/settings/api-keys',
    );
    expect(screen.getByRole('menuitem', { name: /composio byok/i })).toHaveAttribute(
      'href',
      '/settings/connections/add',
    );
  });

  it('hides privileged workspace links for members', () => {
    mocks.storeState.workspaces = [
      { id: 'w1', name: 'Acme', role: 'member', status: 'ready' },
    ];

    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /owner/i }));

    expect(screen.getByRole('menuitem', { name: /account settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /billing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /manage users/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /chat byok/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /composio byok/i })).not.toBeInTheDocument();
  });
});
