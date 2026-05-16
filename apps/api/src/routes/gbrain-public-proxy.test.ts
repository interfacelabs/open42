import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { gbrainPublicProxySlug } from '../gbrain/public-proxy.js';
import { buildPublicGbrainProxyRouter, type PublicGbrainProxyRepo } from './gbrain-public-proxy.js';

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';
const HOST = `${gbrainPublicProxySlug(WORKSPACE_ID)}.proxy.open42.ai`;

function makeRepo(
  overrides: Partial<NonNullable<Awaited<ReturnType<PublicGbrainProxyRepo['findWorkspace']>>>> = {},
) {
  return {
    findWorkspace: vi.fn(async () => ({
      id: WORKSPACE_ID,
      gbrainBaseUrl: 'http://10.42.0.3:18080',
      gbrainPrivateAddress: '10.42.0.3:18080',
      gbrainMcpProxyEnabled: true,
      status: 'ready',
      ...overrides,
    })),
    findActiveClient: vi.fn(async (_workspaceId, clientId) =>
      clientId === 'client-1' ? { id: 'mcp-client-1' } : null,
    ),
    recordIssuedAccessToken: vi.fn(async () => {}),
    findActiveAccessToken: vi.fn(async (_workspaceId, token) =>
      token === 'issued-token' ? { id: 'token-1', clientId: 'mcp-client-1' } : null,
    ),
    markAccessTokenUsed: vi.fn(async () => {}),
    revokeAccessToken: vi.fn(async () => {}),
  } satisfies PublicGbrainProxyRepo;
}

function makeApp(
  opts: {
    repo?: PublicGbrainProxyRepo;
    fetch?: typeof fetch;
  } = {},
) {
  const app = express();
  app.use(
    buildPublicGbrainProxyRouter({
      env: { OPEN42_GBRAIN_PROXY_DOMAIN: 'proxy.open42.ai' },
      fetch: opts.fetch,
      repo: opts.repo ?? makeRepo(),
    }),
  );
  app.use((_req, res) => res.status(418).json({ error: 'fell_through' }));
  return app;
}

describe('public gbrain MCP proxy', () => {
  it('requires a registered Open42 client before routing MCP traffic', async () => {
    const repo = makeRepo();
    const fetchMock = vi.fn(async (url: URL, _init?: RequestInit) => {
      if (String(url).endsWith('/token')) {
        return new Response('{"access_token":"issued-token","expires_in":3600}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '999',
          Connection: 'close',
        },
      });
    });

    const token = await request(makeApp({ repo, fetch: fetchMock as typeof fetch }))
      .post('/token')
      .set('Host', HOST)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('grant_type=client_credentials&client_id=client-1&client_secret=secret-1');

    expect(token.status).toBe(200);
    expect(repo.findActiveClient).toHaveBeenCalledWith(WORKSPACE_ID, 'client-1');
    expect(repo.recordIssuedAccessToken).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      clientId: 'mcp-client-1',
      token: 'issued-token',
      expiresAt: expect.any(Date),
    });

    const res = await request(makeApp({ repo, fetch: fetchMock as typeof fetch }))
      .post('/mcp?transport=http')
      .set('Host', HOST)
      .set('Authorization', 'Bearer issued-token')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":"2.0","method":"tools/list","id":"1"}');

    expect(res.status).toBe(200);
    expect(res.text).toBe('{"ok":true}');
    expect(res.headers['x-open42-gbrain-proxy']).toBe('1');
    expect(res.headers['content-length']).not.toBe('999');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toBe('http://10.42.0.3:18080/mcp?transport=http');
    expect(init?.method).toBe('POST');
    expect(Buffer.from(init?.body as Uint8Array).toString('utf8')).toBe(
      '{"jsonrpc":"2.0","method":"tools/list","id":"1"}',
    );
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer issued-token');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('x-forwarded-host')).toBe(HOST);
    expect(repo.findActiveAccessToken).toHaveBeenCalledWith(WORKSPACE_ID, 'issued-token');
    expect(repo.markAccessTokenUsed).toHaveBeenCalledWith('token-1', 'mcp-client-1');
  });

  it('rejects unissued bearer tokens before reaching gbrain', async () => {
    const fetchMock = vi.fn();
    const res = await request(makeApp({ fetch: fetchMock as typeof fetch }))
      .post('/mcp')
      .set('Host', HOST)
      .set('Authorization', 'Bearer random-token')
      .send('{"jsonrpc":"2.0","method":"tools/list","id":"1"}');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects token requests for unregistered clients', async () => {
    const fetchMock = vi.fn();
    const res = await request(makeApp({ fetch: fetchMock as typeof fetch }))
      .post('/token')
      .set('Host', HOST)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('grant_type=client_credentials&client_id=unknown&client_secret=secret');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_client' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not route disabled workspaces', async () => {
    const fetchMock = vi.fn();
    const repo = makeRepo({ gbrainMcpProxyEnabled: false });
    const res = await request(makeApp({ repo, fetch: fetchMock as typeof fetch }))
      .get('/mcp')
      .set('Host', HOST);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'mcp_proxy_not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose gbrain dynamic client registration publicly', async () => {
    const fetchMock = vi.fn();
    const res = await request(makeApp({ fetch: fetchMock as typeof fetch }))
      .post('/register')
      .set('Host', HOST)
      .send({ client_name: 'attacker' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through for non-proxy hosts', async () => {
    const res = await request(makeApp()).get('/mcp').set('Host', 'api.open42.ai');
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: 'fell_through' });
  });
});
