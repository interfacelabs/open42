import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render, textContent } from '@/test/render';

import { SkillsListScreen } from './SkillsListScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
};

const skillsHook = {
  mutate: vi.fn(async () => undefined),
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
    {
      id: 'skill-2',
      name: 'Incident response',
      version: '1.2.0',
      updatedAt: '2026-05-16T00:00:00.000Z',
      staleness: null,
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

vi.mock('@/hooks/useWorkspaceData', () => ({
  useSkills: () => ({
    error: null,
    isValidating: false,
    mutate: skillsHook.mutate,
    skills: skillsHook.skills,
  }),
}));

const navigation = { navigate: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentWorkspaceId: 'ws-1' });
});

it('renders exported skills with stale badges and opens skill detail', () => {
  const tree = render(
    <SkillsListScreen navigation={navigation} route={{ key: 'SkillsTab', name: 'SkillsTab' }} />
  );

  const copy = textContent(tree.root);
  expect(copy).toContain('Exported artifacts');
  expect(copy).toContain('Refund policy');
  expect(copy).toContain('Refund policy changed after export.');
  expect(copy).toContain('stale');
  expect(copy).toContain('Incident response');
  expect(copy).toContain('v1.2.0');

  act(() => {
    findPressableByText(tree.root, 'Refund policy').props.onPress();
  });

  expect(navigation.navigate).toHaveBeenCalledWith('SkillDetail', {
    skillId: 'skill-1',
    skillName: 'Refund policy',
  });
});
