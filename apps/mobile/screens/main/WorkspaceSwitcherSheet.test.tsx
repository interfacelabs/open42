import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render, textContent } from '@/test/render';

import { WorkspaceSwitcherSheet } from './WorkspaceSwitcherSheet';

const authState = {
  workspaces: [
    { id: 'ws-1', name: 'Open42', role: 'owner' as const, status: 'ready' as const },
    { id: 'ws-2', name: 'Acme Operations', role: 'member' as const, status: 'ready' as const },
  ],
  currentWorkspaceId: 'ws-1',
  refreshWorkspaces: vi.fn(async () => authState.workspaces),
  switchWorkspace: vi.fn(async () => undefined),
};

vi.mock('@/store/auth', () => {
  const useAuthStore = Object.assign(
    (selector: (state: typeof authState) => unknown) => selector(authState),
    {
      setState: (patch: Partial<typeof authState>) => Object.assign(authState, patch),
    }
  );
  return { useAuthStore };
});

const navigation = {
  goBack: vi.fn(),
  navigate: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    workspaces: [
      { id: 'ws-1', name: 'Open42', role: 'owner', status: 'ready' },
      { id: 'ws-2', name: 'Acme Operations', role: 'member', status: 'ready' },
    ],
    currentWorkspaceId: 'ws-1',
  });
});

it('lists workspaces and switches to the selected workspace', async () => {
  const tree = render(
    <WorkspaceSwitcherSheet
      navigation={navigation}
      route={{ key: 'WorkspaceSwitcher', name: 'WorkspaceSwitcher' }}
    />
  );

  expect(textContent(tree.root)).toContain('Open42');
  expect(textContent(tree.root)).toContain('Acme Operations');

  await act(async () => {
    await findPressableByText(tree.root, 'Acme Operations').props.onPress();
  });

  expect(authState.switchWorkspace).toHaveBeenCalledWith('ws-2');
  expect(navigation.goBack).toHaveBeenCalled();
});

it('routes to workspace creation and manual invite acceptance', () => {
  const tree = render(
    <WorkspaceSwitcherSheet
      navigation={navigation}
      route={{ key: 'WorkspaceSwitcher', name: 'WorkspaceSwitcher' }}
    />
  );

  findPressableByText(tree.root, 'Create workspace').props.onPress();
  findPressableByText(tree.root, 'Accept invite').props.onPress();

  expect(navigation.navigate).toHaveBeenCalledWith('OnboardingWorkspace');
  expect(navigation.navigate).toHaveBeenCalledWith('InviteAccept', {});
});
