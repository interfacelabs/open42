import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render, textContent } from '@/test/render';

import { SignOutScreen } from './SignOutScreen';

const authState = {
  signOutRemote: vi.fn(async () => undefined),
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

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ signOutRemote: vi.fn(async () => undefined) });
});

it('confirms sign out and delegates remote session clearing to the auth store', async () => {
  const tree = render(<SignOutScreen />);

  expect(textContent(tree.root)).toContain('End this Open42 session?');
  expect(textContent(tree.root)).toContain('clears the mobile cookie jar');

  await act(async () => {
    await findPressableByText(tree.root, 'Sign out').props.onPress();
  });

  expect(authState.signOutRemote).toHaveBeenCalledTimes(1);
});
