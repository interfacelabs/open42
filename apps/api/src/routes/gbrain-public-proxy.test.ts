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
  it('routes enabled workspace MCP traffic to its private gbrain URL', async () => {
    const fetchMock = vi.fn(
      async (_url: URL, _init?: RequestInit) =>
        new Response('{"ok":true}', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '999',
            Connection: 'close',
          },
        }),
    );

    const res = await request(makeApp({ fetch: fetchMock as typeof fetch }))
      .post('/mcp?transport=http')
      .set('Host', HOST)
      .set('Authorization', 'Bearer gbrain-token')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":"2.0","method":"tools/list","id":"1"}');

    expect(res.status).toBe(200);
    expect(res.text).toBe('{"ok":true}');
    expect(res.headers['x-open42-gbrain-proxy']).toBe('1');
    expect(res.headers['content-length']).not.toBe('999');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://10.42.0.3:18080/mcp?transport=http');
    expect(init?.method).toBe('POST');
    expect(Buffer.from(init?.body as Uint8Array).toString('utf8')).toBe(
      '{"jsonrpc":"2.0","method":"tools/list","id":"1"}',
    );
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer gbrain-token');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('x-forwarded-host')).toBe(HOST);
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
