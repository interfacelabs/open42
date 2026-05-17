import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { beforeEach, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/store/auth';
import { act, findPressableByText, render } from '@/test/render';
import { apiFetch } from '@/utils/api';

import { McpScreen } from './McpScreen';

const authState = {
  currentWorkspaceId: 'ws-1',
};

const mcpMutate = vi.fn(async () => undefined);
let mcpData = {
  enabled: true,
  available: true,
  issuerUrl: 'https://open42.test',
  mcpUrl: 'https://open42.test/mcp',
  role: 'owner' as const,
  myClient: null,
  clients: [] as {
    id: string;
    label: string;
    scopes: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }[],
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
  useMcpProxy: () => ({
    data: mcpData,
    error: null,
    isValidating: false,
    mutate: mcpMutate,
  }),
}));

vi.mock('@/utils/api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/api')>('@/utils/api');
  return {
    ...actual,
    apiFetch: vi.fn(async () => ({
      client: {
        id: 'client-1',
        label: 'Mobile agent',
        scopes: 'read write',
        createdAt: '2026-05-17T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
      clientId: 'client-id-1',
      clientSecret: 'secret-1',
      scope: 'read write',
      grantType: 'client_credentials',
      issuerUrl: 'https://open42.test',
      tokenUrl: 'https://open42.test/oauth/token',
      mcpUrl: 'https://open42.test/mcp',
    })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ currentWorkspaceId: 'ws-1' });
  mcpData = {
    enabled: true,
    available: true,
    issuerUrl: 'https://open42.test',
    mcpUrl: 'https://open42.test/mcp',
    role: 'owner',
    myClient: null,
    clients: [],
  };
  vi.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

it('creates MCP credentials and copies the generated config', async () => {
  const tree = render(<McpScreen />);

  await act(async () => {
    await findPressableByText(tree.root, 'Create credentials').props.onPress();
  });

  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/mcp-proxy/clients', {
    method: 'POST',
    body: { name: 'Mobile agent', scope: 'read write' },
  });

  await act(async () => {
    await findPressableByText(tree.root, 'Copy MCP config').props.onPress();
  });

  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('client-id-1'));
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Open42 MCP config',
      message: expect.stringContaining('secret-1'),
    })
  );
});

it('optimistically toggles the MCP proxy', async () => {
  const tree = render(<McpScreen />);

  await act(async () => {
    await findPressableByText(tree.root, 'Disable').props.onPress();
  });

  expect(mcpMutate).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), false);
  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/mcp-proxy', {
    method: 'POST',
    body: { enabled: false },
  });
});

it('optimistically revokes MCP clients', async () => {
  mcpData = {
    ...mcpData,
    clients: [
      {
        id: 'client-1',
        label: 'Desktop agent',
        scopes: 'read write',
        createdAt: '2026-05-17T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
  };
  const tree = render(<McpScreen />);

  await act(async () => {
    await findPressableByText(tree.root, 'Revoke').props.onPress();
  });

  expect(mcpMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      clients: [expect.objectContaining({ id: 'client-1', revokedAt: expect.any(String) })],
    }),
    false
  );
  expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws-1/mcp-proxy/clients/client-1', {
    method: 'DELETE',
  });
});
