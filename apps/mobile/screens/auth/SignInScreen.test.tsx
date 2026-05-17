import { beforeEach, expect, it, vi } from 'vitest';
import { TextInput } from 'react-native';

import { useAuthStore } from '@/store/auth';
import {
  act,
  findPressableByText,
  findTextInputByPlaceholder,
  render,
  textContent,
} from '@/test/render';
import { apiFetch } from '@/utils/api';

import { SignInScreen } from './SignInScreen';

const authState = {
  restoreSession: vi.fn(async () => undefined),
  user: null,
  currentWorkspaceId: null,
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
    apiFetch: vi.fn(async () => ({ ok: true })),
  };
});

const navigation = { navigate: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, currentWorkspaceId: null });
});

it('sends a sign-in code and reveals code entry', async () => {
  const tree = render(
    <SignInScreen navigation={navigation} route={{ key: 'SignIn', name: 'SignIn' }} />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'you@company.com').props.onChangeText(
      'founder@open42.test'
    );
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Send code').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/auth/signin', {
    method: 'POST',
    body: { email: 'founder@open42.test' },
  });
  expect(textContent(tree.root)).toContain('Verify code');
});

it('verifies the six-digit code and restores the session', async () => {
  const tree = render(
    <SignInScreen navigation={navigation} route={{ key: 'SignIn', name: 'SignIn' }} />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'you@company.com').props.onChangeText(
      'founder@open42.test'
    );
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Send code').props.onPress();
  });

  const codeInputs = tree.root
    .findAllByType(TextInput as any)
    .filter((node) => node.props.keyboardType === 'number-pad');
  for (const [index, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
    await act(async () => {
      codeInputs[index]!.props.onChangeText(digit);
    });
  }

  expect(apiFetch).toHaveBeenCalledWith('/auth/verify', {
    method: 'POST',
    body: { email: 'founder@open42.test', token: '123456', type: 'email' },
  });
  expect(authState.restoreSession).toHaveBeenCalledTimes(1);
});
