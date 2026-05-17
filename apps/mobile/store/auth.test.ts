import { beforeEach, expect, it, vi } from 'vitest';

import type { UserSummary, WorkspaceCurrentPayload, WorkspaceSummary } from '@open42/shared-types';

import { ApiError, apiFetch, clearCookieJar } from '@/utils/api';

import { useAuthStore } from './auth';

vi.mock('@/utils/api', () => {
  class MockApiError extends Error {
    status: number;
    payload: unknown;

    constructor(status: number, payload: unknown) {
      super('api_error');
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  return {
    ApiError: MockApiError,
    apiFetch: vi.fn(),
    clearCookieJar: vi.fn(async () => undefined),
  };
});

const user: UserSummary = {
  id: 'u-1',
  email: 'founder@open42.test',
  currentWorkspaceId: 'ws-1',
};

const current: WorkspaceCurrentPayload = {
  user,
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
  connections: [],
  lastJob: null,
  requiresProviderKeys: false,
  providerKeys: { anthropicChat: true, openaiEmbed: true },
};

const workspaces: WorkspaceSummary[] = [
  { id: 'ws-1', name: 'Open42', role: 'owner', status: 'ready' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    hydrated: false,
    restoring: false,
    user: null,
    workspaces: [],
    current: null,
    currentWorkspaceId: null,
  });
});

it('restores an existing workspace session for cold app open', async () => {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(user)
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ workspaces });

  await useAuthStore.getState().restoreSession();

  expect(apiFetch).toHaveBeenNthCalledWith(1, '/auth/me');
  expect(apiFetch).toHaveBeenNthCalledWith(2, '/workspaces/current');
  expect(apiFetch).toHaveBeenNthCalledWith(3, '/workspaces');
  expect(useAuthStore.getState()).toMatchObject({
    hydrated: true,
    restoring: false,
    user,
    current,
    currentWorkspaceId: 'ws-1',
    workspaces,
  });
});

it('clears local auth state when restore receives 401', async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError(401, { error: 'unauthorized' }));

  await useAuthStore.getState().restoreSession();

  expect(clearCookieJar).toHaveBeenCalled();
  expect(useAuthStore.getState()).toMatchObject({
    hydrated: true,
    restoring: false,
    user: null,
    current: null,
    currentWorkspaceId: null,
    workspaces: [],
  });
});
