import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, findTextInputByPlaceholder, render } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { VerifyDeepLinkScreen } from './VerifyDeepLinkScreen';

const authState = {
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
    apiFetch: vi.fn(async () => ({ ok: true })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ restoreSession: vi.fn(async () => undefined) });
});

it('auto-verifies route params from a magic link', async () => {
  render(
    <VerifyDeepLinkScreen
      navigation={{} as any}
      route={{
        key: 'VerifyDeepLink',
        name: 'VerifyDeepLink',
        params: {
          email: 'founder@open42.test',
          tokenHash: 'hashed-token',
          type: 'magiclink',
        },
      }}
    />
  );

  await act(async () => {
    await Promise.resolve();
  });

  expect(apiFetch).toHaveBeenCalledWith('/auth/verify', {
    method: 'POST',
    body: {
      email: 'founder@open42.test',
      token: undefined,
      tokenHash: 'hashed-token',
      accessToken: undefined,
      type: 'magiclink',
      inviteId: undefined,
    },
  });
  expect(authState.restoreSession).toHaveBeenCalledTimes(1);
});

it('verifies a manually pasted magic-link URL', async () => {
  const tree = render(
    <VerifyDeepLinkScreen
      navigation={{} as any}
      route={{ key: 'VerifyDeepLink', name: 'VerifyDeepLink', params: undefined }}
    />
  );

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'Paste magic link').props.onChangeText(
      'https://open42.app/sign_in?token_hash=manual-hash&type=magiclink&email=founder%40open42.test'
    );
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Verify link').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/auth/verify', {
    method: 'POST',
    body: {
      email: 'founder@open42.test',
      token: undefined,
      tokenHash: 'manual-hash',
      accessToken: undefined,
      type: 'magiclink',
      inviteId: undefined,
    },
  });
  expect(authState.restoreSession).toHaveBeenCalledTimes(1);
});
