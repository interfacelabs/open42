import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render, textContent } from '@/test/render';

import { AccountScreen } from './AccountScreen';

const authState = {
  user: { id: 'u-1', email: 'founder@open42.test' },
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

const navigation = { navigate: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u-1', email: 'founder@open42.test' } });
});

it('shows the signed-in account and routes to sign out confirmation', () => {
  const tree = render(
    <AccountScreen navigation={navigation} route={{ key: 'Account', name: 'Account' }} />
  );

  expect(textContent(tree.root)).toContain('founder@open42.test');
  expect(textContent(tree.root)).toContain('u-1');

  act(() => {
    findPressableByText(tree.root, 'Sign out').props.onPress();
  });

  expect(navigation.navigate).toHaveBeenCalledWith('SignOut');
});
