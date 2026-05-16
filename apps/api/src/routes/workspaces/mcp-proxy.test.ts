import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildWorkspaceMcpProxyRouter, type WorkspaceMcpProxyRepo } from './mcp-proxy.js';

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';
const PUBLIC_BASE_URL = 'https://ws-11111111222243338444555555555555.proxy.open42.ai';

function makeRepo(
  overrides: Partial<NonNullable<Awaited<ReturnType<WorkspaceMcpProxyRepo['findWorkspace']>>>> = {},
): WorkspaceMcpProxyRepo {
  return {
    findWorkspace: vi.fn(async () => ({
      id: WORKSPACE_ID,
      status: 'ready',
      gbrainBaseUrl: 'http://10.42.0.3:18080',
      gbrainPrivateAddress: '10.42.0.3:18080',
      gbrainMcpProxyEnabled: false,
      ...overrides,
    })),
    setEnabled: vi.fn(async () => {}),
    listClients: vi.fn<WorkspaceMcpProxyRepo['listClients']>(async () => []),
    createClient: vi.fn<WorkspaceMcpProxyRepo['createClient']>(async (input) => ({
      id: 'stored-client-1',
      label: input.label,
      scopes: input.scopes,
      createdAt: new Date('2026-05-16T12:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
      createdByUserId: input.createdByUserId,
    })),
    revokeClient: vi.fn(async () => true),
    findActiveClientForUser: vi.fn<WorkspaceMcpProxyRepo['findActiveClientForUser']>(
      async () => null,
    ),
    findUserEmail: vi.fn(async () => 'member@example.com'),
  };
}

function makeApp(
  opts: {
    repo?: WorkspaceMcpProxyRepo;
    fetch?: typeof fetch;
    env?: Record<string, string>;
    role?: 'owner' | 'admin' | 'member';
    userId?: string;
  } = {},
) {
  const role = opts.role ?? 'owner';
  const userId = opts.userId ?? 'user-1';
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: WORKSPACE_ID, role };
    req.session = { id: 'session-1', userId };
    next();
  });
  app.use(
    '/workspaces/:id/mcp-proxy',
    buildWorkspaceMcpProxyRouter({
      env: opts.env ?? { OPEN42_GBRAIN_PROXY_DOMAIN: 'proxy.open42.ai' },
      fetch: opts.fetch,
      repo: opts.repo ?? makeRepo(),
    }),
  );
  return app;
}

describe('workspace MCP proxy management', () => {
  it('returns the stable public MCP URL', async () => {
    const repo = makeRepo({ gbrainMcpProxyEnabled: true });
    const res = await request(makeApp({ repo })).get(`/workspaces/${WORKSPACE_ID}/mcp-proxy`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      available: true,
      issuerUrl: PUBLIC_BASE_URL,
      mcpUrl: `${PUBLIC_BASE_URL}/mcp`,
      role: 'owner',
      myClient: null,
      clients: [],
    });
  });

  it('enables the proxy only when the workspace gbrain is ready', async () => {
    const repo = makeRepo();
    const res = await request(makeApp({ repo }))
      .post(`/workspaces/${WORKSPACE_ID}/mcp-proxy`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(repo.setEnabled).toHaveBeenCalledWith(WORKSPACE_ID, true);
    expect(res.body.enabled).toBe(true);
  });

  it('rejects enable when no proxy domain is configured', async () => {
    const repo = makeRepo();
    const res = await request(makeApp({ repo, env: {} }))
      .post(`/workspaces/${WORKSPACE_ID}/mcp-proxy`)
      .send({ enabled: true });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'mcp_proxy_domain_not_configured' });
    expect(repo.setEnabled).not.toHaveBeenCalled();
  });

  it('creates client_credentials through the private gbrain URL', async () => {
    const repo = makeRepo({ gbrainMcpProxyEnabled: true });
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ client_id: 'client-1', client_secret: 'secret-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const res = await request(makeApp({ repo, fetch: fetchMock as typeof fetch }))
      .post(`/workspaces/${WORKSPACE_ID}/mcp-proxy/clients`)
      .send({ name: 'Claude Code', scope: 'read write' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      client: {
        id: 'stored-client-1',
        label: 'Claude Code',
        scopes: 'read write',
        createdAt: '2026-05-16T12:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
      clientId: 'client-1',
      clientSecret: 'secret-1',
      scope: 'read write',
      grantType: 'client_credentials',
      issuerUrl: PUBLIC_BASE_URL,
      tokenUrl: `${PUBLIC_BASE_URL}/token`,
      mcpUrl: `${PUBLIC_BASE_URL}/mcp`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://10.42.0.3:18080/register');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      client_name: 'Claude Code',
      grant_types: ['client_credentials'],
      redirect_uris: [],
      scope: 'read write',
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(repo.createClient).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      createdByUserId: 'user-1',
      label: 'Claude Code',
      clientId: 'client-1',
      scopes: 'read write',
    });
  });

  it('revokes a client', async () => {
    const repo = makeRepo({ gbrainMcpProxyEnabled: true });
    const res = await request(makeApp({ repo })).delete(
      `/workspaces/${WORKSPACE_ID}/mcp-proxy/clients/stored-client-1`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Admin revoke: creator filter is absent so the repo can revoke any
    // workspace client regardless of who created it.
    expect(repo.revokeClient).toHaveBeenCalledWith(WORKSPACE_ID, 'stored-client-1', {
      creatorUserId: undefined,
    });
  });

  describe('member self-claim', () => {
    function memberClientRow(overrides: Partial<{ id: string; createdByUserId: string }> = {}) {
      return {
        id: overrides.id ?? 'stored-member-1',
        label: 'Personal — member@example.com',
        scopes: 'read write',
        createdAt: new Date('2026-05-16T12:00:00Z'),
        lastUsedAt: null,
        revokedAt: null,
        createdByUserId: overrides.createdByUserId ?? 'user-member',
      };
    }

    it('GET filters clients for non-admin members and surfaces myClient', async () => {
      const memberClient = memberClientRow({ createdByUserId: 'user-member' });
      const ownerClient = {
        ...memberClient,
        id: 'stored-owner-1',
        label: 'Shared',
        createdByUserId: 'user-owner',
      };
      const repo = makeRepo({ gbrainMcpProxyEnabled: true });
      repo.listClients = vi.fn(async () => [ownerClient, memberClient]);

      const res = await request(makeApp({ repo, role: 'member', userId: 'user-member' })).get(
        `/workspaces/${WORKSPACE_ID}/mcp-proxy`,
      );

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('member');
      // Member sees only their own client in the list.
      expect(res.body.clients).toHaveLength(1);
      expect(res.body.clients[0].id).toBe('stored-member-1');
      // myClient mirrors the member's active client for the self-claim UI.
      expect(res.body.myClient).toMatchObject({
        id: 'stored-member-1',
        scopes: 'read write',
      });
    });

    it('rejects enable/disable for non-admin members', async () => {
      const repo = makeRepo();
      const res = await request(makeApp({ repo, role: 'member', userId: 'user-member' }))
        .post(`/workspaces/${WORKSPACE_ID}/mcp-proxy`)
        .send({ enabled: true });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden_cannot_manage_mcp_proxy' });
      expect(repo.setEnabled).not.toHaveBeenCalled();
    });

    it('rejects the named create endpoint for non-admin members', async () => {
      const repo = makeRepo({ gbrainMcpProxyEnabled: true });
      const res = await request(makeApp({ repo, role: 'member', userId: 'user-member' }))
        .post(`/workspaces/${WORKSPACE_ID}/mcp-proxy/clients`)
        .send({ name: 'Claude Code', scope: 'read write' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden_cannot_manage_mcp_proxy' });
      expect(repo.createClient).not.toHaveBeenCalled();
    });

    it('POST /clients/self issues a read+write client labeled with the user email', async () => {
      const repo = makeRepo({ gbrainMcpProxyEnabled: true });
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ client_id: 'gbrain-self-1', client_secret: 'self-secret' }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
      );

      const res = await request(
        makeApp({ repo, fetch: fetchMock as typeof fetch, role: 'member', userId: 'user-member' }),
      ).post(`/workspaces/${WORKSPACE_ID}/mcp-proxy/clients/self`);

      expect(res.status).toBe(201);
      expect(res.body.scope).toBe('read write');
      expect(res.body.clientSecret).toBe('self-secret');
      expect(res.body.client.label).toBe('Personal — member@example.com');
      expect(repo.createClient).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        createdByUserId: 'user-member',
        label: 'Personal — member@example.com',
        clientId: 'gbrain-self-1',
        scopes: 'read write',
      });
      // The gbrain registration call inherits the same default member scope.
      const init = fetchMock.mock.calls[0]?.[1];
      expect(JSON.parse(String(init?.body))).toMatchObject({ scope: 'read write' });
    });

    it('POST /clients/self refuses when the member already has an active client', async () => {
      const repo = makeRepo({ gbrainMcpProxyEnabled: true });
      repo.findActiveClientForUser = vi.fn(async () => memberClientRow());
      const fetchMock = vi.fn();

      const res = await request(
        makeApp({ repo, fetch: fetchMock as typeof fetch, role: 'member', userId: 'user-member' }),
      ).post(`/workspaces/${WORKSPACE_ID}/mcp-proxy/clients/self`);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'mcp_client_already_issued' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(repo.createClient).not.toHaveBeenCalled();
    });

    it('POST /clients/self is rejected when the proxy is disabled', async () => {
      const repo = makeRepo({ gbrainMcpProxyEnabled: false });
      const res = await request(makeApp({ repo, role: 'member', userId: 'user-member' })).post(
        `/workspaces/${WORKSPACE_ID}/mcp-proxy/clients/self`,
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'mcp_proxy_disabled' });
    });

    it('member revoke passes their userId so the repo can scope the update', async () => {
      const repo = makeRepo({ gbrainMcpProxyEnabled: true });
      const res = await request(makeApp({ repo, role: 'member', userId: 'user-member' })).delete(
        `/workspaces/${WORKSPACE_ID}/mcp-proxy/clients/stored-member-1`,
      );

      expect(res.status).toBe(200);
      expect(repo.revokeClient).toHaveBeenCalledWith(WORKSPACE_ID, 'stored-member-1', {
        creatorUserId: 'user-member',
      });
    });
  });
});
