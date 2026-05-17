import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, findTextInputByPlaceholder, render } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { MembersScreen } from './MembersScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
};

const membersMutate = vi.fn(async () => undefined);
const invitesMutate = vi.fn(async () => undefined);
let membersData = {
  members: [
    {
      userId: 'u-1',
      email: 'founder@open42.test',
      role: 'owner',
      joinedAt: '2026-05-17T00:00:00.000Z',
    },
  ],
};
let invitesData: {
  invites: {
    id: string;
    email: string;
    role: 'admin' | 'member';
    status: 'pending' | 'accepted' | 'revoked';
    createdAt: string;
  }[];
} = { invites: [] };

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

vi.mock('swr', () => ({
  default: (key: string) => {
    if (key.includes('/members')) {
      return {
        data: membersData,
        isValidating: false,
        mutate: membersMutate,
      };
    }
    return {
      data: invitesData,
      isValidating: false,
      mutate: invitesMutate,
    };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentWorkspaceId: 'ws-1' });
  membersData = {
    members: [
      {
        userId: 'u-1',
        email: 'founder@open42.test',
        role: 'owner',
        joinedAt: '2026-05-17T00:00:00.000Z',
      },
    ],
  };
  invitesData = { invites: [] };
});

it('sends teammate invites through the workspace invite endpoint', async () => {
  const tree = render(<MembersScreen />);

  await act(async () => {
    findTextInputByPlaceholder(tree.root, 'teammate@company.com').props.onChangeText(
      'ana@company.com, tom@company.com'
    );
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Send invite').props.onPress();
  });

  expect(invitesMutate).toHaveBeenCalledWith(
    {
      invites: expect.arrayContaining([
        expect.objectContaining({ email: 'ana@company.com', status: 'pending' }),
        expect.objectContaining({ email: 'tom@company.com', status: 'pending' }),
      ]),
    },
    false
  );
  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/invites', {
    method: 'POST',
    body: { emails: ['ana@company.com', 'tom@company.com'] },
  });
});

it('optimistically revokes pending invites', async () => {
  invitesData = {
    invites: [
      {
        id: 'inv-1',
        email: 'ana@company.com',
        role: 'member',
        status: 'pending',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
  };
  const tree = render(<MembersScreen />);

  await act(async () => {
    await findPressableByText(tree.root, 'Revoke').props.onPress();
  });

  expect(invitesMutate).toHaveBeenCalledWith({ invites: [] }, false);
  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/invites/inv-1', {
    method: 'DELETE',
  });
});
