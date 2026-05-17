import { beforeEach, expect, it, vi } from 'vitest';

import {
  act,
  findPressableByText,
  findTextInputByPlaceholder,
  render,
  textContent,
} from '@/test/render';
import { apiFetch } from '@/utils/api';

import { ApiKeysScreen } from './ApiKeysScreen';

const mutate = vi.fn(async () => undefined);
const authState = {
  currentWorkspaceId: 'ws-1',
};
let swrState: {
  data: {
    credentials: {
      provider: 'openai' | 'anthropic';
      scope: 'chat' | 'embed';
      model?: string | null;
      createdAt: string;
    }[];
  };
  error: null | Error;
  isValidating: boolean;
  mutate: typeof mutate;
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

vi.mock('swr', () => ({
  default: vi.fn(() => swrState),
}));

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({ ok: true })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.currentWorkspaceId = 'ws-1';
  swrState = {
    data: { credentials: [] },
    error: null,
    isValidating: false,
    mutate,
  };
});

it('saves a provider key through the workspace credentials endpoint', async () => {
  const tree = render(<ApiKeysScreen />);

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'sk-...').props.onChangeText('sk-test');
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Save key').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/credentials', {
    method: 'POST',
    body: { provider: 'openai', scope: 'chat', apiKey: 'sk-test' },
  });
  expect(textContent(tree.root)).toContain('Provider keys');
});

it('hides key entry when the workspace credentials route is owner-only', () => {
  swrState.error = new Error('forbidden_owner_only');

  const tree = render(<ApiKeysScreen />);

  expect(textContent(tree.root)).toContain('Owner access required.');
  expect(textContent(tree.root)).not.toContain('Add a key');
});

it('optimistically removes configured provider keys', async () => {
  swrState.data = {
    credentials: [
      {
        provider: 'openai',
        scope: 'chat',
        model: 'gpt-4.1',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
  };
  const tree = render(<ApiKeysScreen />);

  await act(async () => {
    await findPressableByText(tree.root, 'Remove').props.onPress();
  });

  expect(mutate).toHaveBeenCalledWith({ credentials: [] }, false);
  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/credentials', {
    method: 'DELETE',
    body: { provider: 'openai', scope: 'chat' },
  });
});
