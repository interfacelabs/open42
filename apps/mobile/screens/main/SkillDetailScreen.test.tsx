import { Share } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render, textContent } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { SkillDetailScreen } from './SkillDetailScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
  current: null as unknown,
};

const skillsState = {
  cacheShareLink: vi.fn(),
  shareLinks: {} as Record<string, { url: string; expiresAt: string }>,
  shareLinkRemainingMs: vi.fn((skillId: string, now = Date.now()) => {
    const link = skillsState.shareLinks[skillId];
    if (!link) return null;
    return Math.max(0, new Date(link.expiresAt).getTime() - now);
  }),
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

vi.mock('@/store/skills', () => ({
  useSkillsStore: (selector: (state: typeof skillsState) => unknown) => selector(skillsState),
}));

vi.mock('swr', () => ({
  default: () => ({
    data: {
      draft: {
        id: 'skill-1',
        name: 'refund-policy',
        version: '1.0.0',
        body: '# Refund policy',
        cites: [{ index: 1, slug: 'refund-policy' }],
        revisions: [],
        staleness: null,
      },
    },
    mutate: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({
      url: 'https://open42.test/shared/abc.zip',
      expiresAt: '2026-05-18T00:00:00.000Z',
    })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  skillsState.shareLinks = {};
  vi.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  useAuthStore.setState({
    currentWorkspaceId: 'ws-1',
    current: {
      user: { id: 'u-1', email: 'founder@open42.test' },
      workspace: {
        id: 'ws-1',
        name: 'Open42',
        plan: null,
        status: 'ready',
        gbrainReady: true,
        runtime: 'ready',
        lastError: null,
        provisionAttempts: 1,
        provisioningStartedAt: '2026-05-17T00:00:00.000Z',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      invites: [],
      connections: [],
      lastJob: null,
      requiresProviderKeys: false,
      providerKeys: { anthropicChat: true, openaiEmbed: true },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it('generates and shares a skill link', async () => {
  const tree = render(
    <SkillDetailScreen
      navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any}
      route={{
        key: 'SkillDetail',
        name: 'SkillDetail',
        params: { skillId: 'skill-1', skillName: 'refund-policy' },
      }}
    />
  );

  await act(async () => {
    findPressableByText(tree.root, 'Share or install').props.onPress();
  });
  await act(async () => {
    await findPressableByText(tree.root, 'Generate share link').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/skills/skill-1/share', {
    method: 'POST',
  });
  expect(skillsState.cacheShareLink).toHaveBeenCalledWith('skill-1', {
    url: 'https://open42.test/shared/abc.zip',
    expiresAt: '2026-05-18T00:00:00.000Z',
  });
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'refund-policy skill',
      message: expect.stringContaining('https://open42.test/shared/abc.zip'),
      url: 'https://open42.test/shared/abc.zip',
    })
  );
});

it('shows a cached share-link TTL countdown', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-17T23:00:00.000Z'));
  skillsState.shareLinks = {
    'skill-1': {
      url: 'https://open42.test/shared/abc.zip',
      expiresAt: '2026-05-18T00:00:00.000Z',
    },
  };
  const tree = render(
    <SkillDetailScreen
      navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any}
      route={{
        key: 'SkillDetail',
        name: 'SkillDetail',
        params: { skillId: 'skill-1', skillName: 'refund-policy' },
      }}
    />
  );

  await act(async () => {
    findPressableByText(tree.root, 'Share or install').props.onPress();
  });

  expect(textContent(tree.root)).toContain('Cached link: 1h remaining.');
});

it('opens install instructions and links to MCP setup', async () => {
  const navigate = vi.fn();
  const tree = render(
    <SkillDetailScreen
      navigation={{ navigate, goBack: vi.fn() } as any}
      route={{
        key: 'SkillDetail',
        name: 'SkillDetail',
        params: { skillId: 'skill-1', skillName: 'refund-policy' },
      }}
    />
  );

  await act(async () => {
    findPressableByText(tree.root, 'Share or install').props.onPress();
  });
  await act(async () => {
    findPressableByText(tree.root, 'Open install instructions').props.onPress();
  });

  expect(textContent(tree.root)).toContain('Claude Code');
  expect(textContent(tree.root)).toContain('~/.claude/skills/refund-policy');

  await act(async () => {
    findPressableByText(tree.root, 'Connect MCP-compatible agent').props.onPress();
  });

  expect(navigate).toHaveBeenCalledWith('Mcp');
});
