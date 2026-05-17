import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { InviteAcceptScreen } from './InviteAcceptScreen';

const authState = {
  user: { id: 'u-1', email: 'founder@open42.test' },
  currentWorkspaceId: 'ws-1',
  restoreSession: vi.fn(async () => undefined),
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

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ workspace: { name: 'Acme Operations' } })),
  };
});

const navigation = {
  canGoBack: vi.fn(() => false),
  goBack: vi.fn(),
  reset: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u-1', email: 'founder@open42.test' },
    currentWorkspaceId: 'ws-1',
  });
});

it('accepts a signed-in workspace invite and restores the session', async () => {
  const tree = render(
    <InviteAcceptScreen
      navigation={navigation}
      route={{
        key: 'InviteAccept',
        name: 'InviteAccept',
        params: {
          inviteId: 'inv-1',
          workspaceName: 'Acme Operations',
          inviterEmail: 'owner@acme.test',
        },
      }}
    />
  );

  await act(async () => {
    await findPressableByText(tree.root, 'Accept invite').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/invites/inv-1/accept', {
    method: 'POST',
  });
  expect(authState.restoreSession).toHaveBeenCalled();
  expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
});

it('verifies a magic-link invite before restoring the session', async () => {
  useAuthStore.setState({
    user: null,
    currentWorkspaceId: null,
  });
  const tree = render(
    <InviteAcceptScreen
      navigation={navigation}
      route={{
        key: 'InviteAccept',
        name: 'InviteAccept',
        params: {
          inviteId: 'inv-2',
          tokenHash: 'hashed-token',
          type: 'invite',
          workspaceName: 'Mobile Team',
          inviterEmail: 'owner@mobile.test',
        },
      }}
    />
  );

  await act(async () => {
    await findPressableByText(tree.root, 'Accept invite').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/auth/verify', {
    method: 'POST',
    body: { inviteId: 'inv-2', tokenHash: 'hashed-token', type: 'invite' },
  });
  expect(authState.restoreSession).toHaveBeenCalled();
  expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
});
