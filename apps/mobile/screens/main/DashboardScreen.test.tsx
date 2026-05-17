import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { useChatStore } from '@/store/chat';
import { act, findPressableByText, render, textContent } from '@/test/render';

import { DashboardScreen } from './DashboardScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
  current: {
    user: { id: 'u-1', email: 'founder@open42.test' },
    workspace: {
      id: 'ws-1',
      name: 'Open42',
      plan: 'starter' as const,
      status: 'ready',
      gbrainReady: true,
      runtime: 'ready' as const,
      lastError: null,
      provisionAttempts: 1,
      provisioningStartedAt: '2026-05-17T00:00:00.000Z',
      createdAt: '2026-05-17T00:00:00.000Z',
    },
    invites: [
      {
        id: 'inv-1',
        email: 'teammate@open42.test',
        status: 'pending',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
    connections: [{ id: 'conn-1', kind: 'notion', status: 'ready', displayName: 'Notion' }],
    lastJob: {
      id: 'job-1',
      status: 'completed',
      pagesTotal: 42,
      createdAt: '2026-05-17T00:00:00.000Z',
    },
    requiresProviderKeys: false,
    providerKeys: { anthropicChat: true, openaiEmbed: true },
  },
  workspaces: [
    { id: 'ws-1', name: 'Open42', role: 'owner' as const, status: 'ready' as const },
    { id: 'ws-2', name: 'Acme Operations', role: 'member' as const, status: 'ready' as const },
  ],
  refreshCurrent: vi.fn(async () => authState.current),
  refreshWorkspaces: vi.fn(async () => authState.workspaces),
};

const chatState = {
  messages: [
    { id: 'u-1', role: 'user' as const, text: 'What is the refund policy?' },
    {
      id: 'a-1',
      role: 'assistant' as const,
      text: 'Enterprise refunds are allowed [1].',
      citations: [
        {
          index: 1,
          slug: 'refund-policy',
          version_id: 2,
          last_updated: '2026-05-01T00:00:00.000Z',
          excerpt: 'Enterprise refunds are allowed.',
        },
      ],
    },
  ],
};

const workspaceHooks = {
  currentMutate: vi.fn(async () => undefined),
  skillsMutate: vi.fn(async () => undefined),
  skills: [
    {
      id: 'skill-1',
      name: 'Refund policy',
      version: '1.0.0',
      updatedAt: '2026-05-17T00:00:00.000Z',
      staleness: {
        changelog: 'Refund policy changed after export.',
        detectedAt: '2026-05-17T00:00:00.000Z',
      },
    },
  ],
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

vi.mock('@/store/chat', () => {
  const useChatStore = Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      setState: (patch: Partial<typeof chatState>) => Object.assign(chatState, patch),
    }
  );
  return { useChatStore };
});

vi.mock('@/hooks/useWorkspaceData', () => ({
  useCurrentWorkspace: () => ({
    data: authState.current,
    error: null,
    isValidating: false,
    mutate: workspaceHooks.currentMutate,
  }),
  useSkills: () => ({
    error: null,
    isValidating: false,
    mutate: workspaceHooks.skillsMutate,
    skills: workspaceHooks.skills,
  }),
}));

const navigation = { navigate: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    currentWorkspaceId: 'ws-1',
    current: authState.current,
    workspaces: authState.workspaces,
  });
  useChatStore.setState({ messages: chatState.messages });
});

it('renders workspace status, recent chat, and stale recent skills', () => {
  const tree = render(
    <DashboardScreen navigation={navigation} route={{ key: 'HomeTab', name: 'HomeTab' }} />
  );

  const copy = textContent(tree.root);
  expect(copy).toContain('Open42');
  expect(copy).toContain('Ready to answer with citations.');
  expect(copy).toContain('Enterprise refunds are allowed [1].');
  expect(copy).toContain('Refund policy');
  expect(copy).toContain('Refund policy changed after export.');
  expect(copy).toContain('stale');
});

it('routes to workspace switcher, settings, chat, and skill details', async () => {
  const tree = render(
    <DashboardScreen navigation={navigation} route={{ key: 'HomeTab', name: 'HomeTab' }} />
  );

  act(() => findPressableByText(tree.root, 'Switch').props.onPress());
  act(() => findPressableByText(tree.root, 'Settings').props.onPress());
  act(() => findPressableByText(tree.root, 'Enterprise refunds are allowed [1].').props.onPress());
  act(() => findPressableByText(tree.root, 'Refund policy').props.onPress());

  expect(navigation.navigate).toHaveBeenCalledWith('WorkspaceSwitcher');
  expect(navigation.navigate).toHaveBeenCalledWith('SettingsHome');
  expect(navigation.navigate).toHaveBeenCalledWith('ChatTab');
  expect(navigation.navigate).toHaveBeenCalledWith('SkillDetail', {
    skillId: 'skill-1',
    skillName: 'Refund policy',
  });
});
