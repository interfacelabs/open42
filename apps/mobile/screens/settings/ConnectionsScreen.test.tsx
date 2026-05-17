import { expect, it, vi } from 'vitest';

import { render, textContent } from '@/test/render';

import { ConnectionsScreen } from './ConnectionsScreen';

vi.mock('@/hooks/useWorkspaceData', () => ({
  useCurrentWorkspace: () => ({
    data: {
      user: { id: 'u-1', email: 'founder@open42.test' },
      workspace: {
        id: 'ws-1',
        name: 'Open42',
        plan: 'starter',
        status: 'ready',
        gbrainReady: true,
        runtime: 'ready',
        lastError: null,
        provisionAttempts: 1,
        provisioningStartedAt: '2026-05-17T00:00:00.000Z',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      invites: [],
      connections: [
        { id: 'conn-1', kind: 'notion', status: 'ready', displayName: 'Company Notion' },
      ],
      lastJob: null,
      requiresProviderKeys: false,
      providerKeys: { anthropicChat: true, openaiEmbed: true },
    },
    error: null,
    isValidating: false,
    mutate: vi.fn(async () => undefined),
  }),
}));

it('renders connected sources while keeping new connector flows desktop-first', () => {
  const tree = render(<ConnectionsScreen />);
  const copy = textContent(tree.root);

  expect(copy).toContain('Source connectors');
  expect(copy).toContain('New OAuth and ingest flows stay on desktop in P1.');
  expect(copy).toContain('Company Notion');
  expect(copy).toContain('notion');
  expect(copy).toContain('ready');
});
