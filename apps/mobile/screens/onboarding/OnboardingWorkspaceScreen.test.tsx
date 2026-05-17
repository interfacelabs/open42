import { beforeEach, expect, it, vi } from 'vitest';

import {
  act,
  findPressableByText,
  findTextInputByPlaceholder,
  render,
  textContent,
} from '@/test/render';
import { apiFetch } from '@/utils/api';

import { OnboardingWorkspaceScreen } from './OnboardingWorkspaceScreen';

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ workspace: { id: 'ws-1', name: 'Acme Operations' } })),
  };
});

const navigation = { navigate: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

it('creates a workspace and advances to teammate invites', async () => {
  const tree = render(
    <OnboardingWorkspaceScreen
      navigation={navigation}
      route={{ key: 'OnboardingWorkspace', name: 'OnboardingWorkspace' }}
    />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'Acme Operations').props.onChangeText(
      ' Acme Operations '
    );
  });

  expect(textContent(tree.root)).toContain('/acme-operations');

  await act(async () => {
    await findPressableByText(tree.root, 'Create workspace').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/onboarding/workspace', {
    method: 'POST',
    body: { name: 'Acme Operations' },
  });
  expect(navigation.navigate).toHaveBeenCalledWith('OnboardingInvites', {
    workspaceName: 'Acme Operations',
  });
});
