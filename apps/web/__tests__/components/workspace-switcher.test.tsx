import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ push: pushMock, pathname: '/' }),
}));

const switchToMock = vi.fn();
const storeState = {
  workspaces: [
    { id: 'w1', name: 'Personal', role: 'owner', status: 'ready' },
    { id: 'w2', name: 'Acme', role: 'member', status: 'ready' },
  ],
  currentWorkspaceId: 'w1',
  switchTo: switchToMock,
};
vi.mock('@/lib/workspaces/store', () => ({
  useWorkspaceStore: () => storeState,
  useHydrateWorkspaceStore: () => undefined,
}));

import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    pushMock.mockReset();
    switchToMock.mockReset();
  });

  it('renders the current workspace name on the button', () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByRole('button')).toHaveTextContent('Personal');
  });

  it('shows owned + joined groups when opened', () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Workspaces you own')).toBeInTheDocument();
    expect(screen.getByText(/Workspaces you.{1,2}ve joined/i)).toBeInTheDocument();
    // "Personal" appears in both the button label and the menu row → use getAllByText
    expect(screen.getAllByText('Personal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('"+ Create new workspace" routes to /auth/onboard?mode=create', () => {
    render(<WorkspaceSwitcher />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Create new workspace/i));
    expect(pushMock).toHaveBeenCalledWith('/auth/onboard?mode=create');
  });

  it('closes the dropdown when clicking outside', () => {
    render(
      <>
        <WorkspaceSwitcher />
        <div data-testid="outside">outside</div>
      </>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Workspaces you own/i)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText(/Workspaces you own/i)).not.toBeInTheDocument();
  });
});
