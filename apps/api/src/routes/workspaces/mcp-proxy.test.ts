import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildWorkspaceMcpProxyRouter, type WorkspaceMcpProxyRepo } from './mcp-proxy.js';

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';
const PUBLIC_BASE_URL = 'https://ws-11111111222243338444555555555555.proxy.open42.ai';

function makeRepo(
  overrides: Partial<NonNullable<Awaited<ReturnType<WorkspaceMcpProxyRepo['findWorkspace']>>>> = {},
) {
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
    listClients: vi.fn(async () => []),
    createClient: vi.fn(async (input) => ({
      id: 'stored-client-1',
      label: input.label,
      scopes: input.scopes,
      createdAt: new Date('2026-05-16T12:00:00Z'),
      lastUsedAt: null,
      revokedAt: null,
    })),
    revokeClient: vi.fn(async () => true),
  } satisfies WorkspaceMcpProxyRepo;
}

function makeApp(
  opts: {
    repo?: WorkspaceMcpProxyRepo;
    fetch?: typeof fetch;
    env?: Record<string, string>;
  } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: WORKSPACE_ID, role: 'owner' };
    req.session = { id: 'session-1', userId: 'user-1' };
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
    expect(repo.revokeClient).toHaveBeenCalledWith(WORKSPACE_ID, 'stored-client-1');
  });
});
