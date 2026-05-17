import { expect, it, vi } from 'vitest';

import { render, textContent } from '@/test/render';

import { PlanScreen } from './PlanScreen';

vi.mock('@/hooks/useWorkspaceData', () => ({
  useCurrentWorkspace: () => ({
    data: {
      user: { id: 'u-1', email: 'founder@open42.test' },
      workspace: {
        id: 'ws-1',
        name: 'Open42',
        plan: 'team',
        status: 'ready',
        gbrainReady: true,
        runtime: 'ready',
        lastError: null,
        provisionAttempts: 1,
        provisioningStartedAt: '2026-05-17T00:00:00.000Z',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      invites: [{ id: 'inv-1', email: 'teammate@open42.test', status: 'pending' }],
      connections: [{ id: 'conn-1', kind: 'notion', status: 'ready', displayName: 'Notion' }],
      lastJob: null,
      requiresProviderKeys: false,
      providerKeys: { anthropicChat: true, openaiEmbed: false },
    },
    error: null,
    isValidating: false,
    mutate: vi.fn(async () => undefined),
  }),
}));

it('renders the current workspace plan and provider-key state', () => {
  const tree = render(<PlanScreen />);
  const copy = textContent(tree.root);

  expect(copy).toContain('Workspace plan');
  expect(copy).toContain('team');
  expect(copy).toContain('Open42');
  expect(copy).toContain('Provider keys: Anthropic chat set · OpenAI embed unset');
});
