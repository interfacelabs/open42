import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../crypto/envelope.js';
import {
  GbrainClient,
  GbrainHttpError,
  clearGbrainTokenCache,
  parseMcpHttpPayload,
  registerGbrainOAuthClient,
} from './client.js';

const TEST_KEK = '1'.repeat(64);

describe('GbrainClient', () => {
  beforeEach(() => {
    process.env.OPEN42_KEK = TEST_KEK;
    clearGbrainTokenCache();
  });

  it('exchanges client credentials, calls tools, and caches tokens by workspace', async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/token')) {
        tokenRequests += 1;
        expect(String(init?.body)).toContain('client_id=client_1');
        expect(String(init?.body)).toContain('client_secret=secret_1');
        return json({ access_token: `token_${tokenRequests}`, expires_in: 3600 });
      }
      if (href.endsWith('/mcp')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer token_1' });
        const body = JSON.parse(String(init?.body));
        expect(body.method).toBe('tools/call');
        expect(body.params.name).toBe('query');
        return json({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify({ chunks: [{ slug: 'refund' }] }) }] },
        });
      }
      throw new Error(`unexpected URL ${href}`);
    });

    const client = new GbrainClient(
      {
        workspaceId: 'workspace-1',
        baseUrl: 'http://brain.internal/',
        oauthClientId: 'client_1',
        oauthClientSecretCiphertext: encryptSecret('secret_1', {
          workspaceId: 'workspace-1',
          purpose: 'gbrain_oauth_secret',
        }),
      },
      { fetch: fetchMock as typeof fetch },
    );

    await expect(client.query({ query: 'refund policy' })).resolves.toEqual({
      chunks: [{ slug: 'refund' }],
    });
    await expect(client.query({ query: 'enterprise refund' })).resolves.toEqual({
      chunks: [{ slug: 'refund' }],
    });
    expect(tokenRequests).toBe(1);
  });

  it('parses server-sent MCP payloads', () => {
    expect(parseMcpHttpPayload('event: message\ndata: {"result":{"ok":true}}\n\n')).toEqual({
      result: { ok: true },
    });
    expect(parseMcpHttpPayload('')).toEqual({});
    expect(parseMcpHttpPayload('event: message\ndata:\n\n')).toEqual({});
  });

  it('registers a gbrain OAuth client through DCR', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        client_name: 'open42',
        grant_types: ['client_credentials'],
      });
      return json({ client_id: 'client_a', client_secret: 'secret_a' });
    });

    await expect(registerGbrainOAuthClient('http://brain', fetchMock as typeof fetch)).resolves.toEqual({
      client_id: 'client_a',
      client_secret: 'secret_a',
    });
  });

  it('calls the full Phase 1 tool wrapper surface', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/token')) return json({ access_token: 'token_wrappers', expires_in: 120 });
      if (href.endsWith('/health')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer token_wrappers' });
        return json({ status: 'ok', version: '0.27.1' });
      }
      if (href.endsWith('/mcp')) {
        const body = JSON.parse(String(init?.body));
        const name = body.params.name;
        calls.push(name);
        if (name === 'submit_job') {
          expect(body.params.arguments).toEqual({ name: 'sync', data: { path: '/tmp/import' } });
          return json({ result: { job_id: 42 } });
        }
        if (name === 'get_job_progress') {
          expect(body.params.arguments).toEqual({ id: 42 });
          return json({ result: { content: [{ type: 'text', text: 'queued' }] } });
        }
        if (name === 'get_chunks') {
          return json({ result: { content: [{ type: 'text', text: JSON.stringify({ not: 'an array' }) }] } });
        }
        return json({ result: { content: [{ type: 'text', text: JSON.stringify({ ok: name }) }] } });
      }
      throw new Error(`unexpected URL ${href}`);
    });
    const client = new GbrainClient(
      {
        workspaceId: 'workspace-wrappers',
        baseUrl: 'http://brain.internal',
        oauthClientId: 'client_wrappers',
        oauthClientSecret: 'secret_wrappers',
      },
      { fetch: fetchMock as typeof fetch },
    );

    await expect(client.putPage('refund-policy', '# Refunds')).resolves.toEqual({ ok: 'put_page' });
    await expect(client.getChunks('refund-policy')).resolves.toEqual([]);
    await expect(client.getVersions('refund-policy')).resolves.toEqual({ ok: 'get_versions' });
    await expect(client.listPages({ limit: 5 })).resolves.toEqual({ ok: 'list_pages' });
    await expect(client.submitJob('sync', { path: '/tmp/import' })).resolves.toEqual({ job_id: 42 });
    await expect(client.getJobProgress('42')).resolves.toBe('queued');
    await expect(client.getHealth()).resolves.toEqual({ status: 'ok', version: '0.27.1' });
    await expect(client.getStats()).resolves.toEqual({ ok: 'get_stats' });
    expect(calls).toEqual([
      'put_page',
      'get_chunks',
      'get_versions',
      'list_pages',
      'submit_job',
      'get_job_progress',
      'get_stats',
    ]);
  });

  it('throws structured errors for MCP failures', async () => {
    const client = clientWithFetch(async (url: string | URL | Request) => {
      if (String(url).endsWith('/token')) return json({ access_token: 'token_errors', expires_in: 3600 });
      return json({ error: { code: -32000, message: 'tool failed' } });
    });

    await expect(client.query({ query: 'refund' })).rejects.toMatchObject({
      name: 'GbrainHttpError',
      status: 200,
      details: { code: -32000, message: 'tool failed' },
    });
  });

  it('throws when an MCP tool result reports isError', async () => {
    const client = clientWithFetch(async (url: string | URL | Request) => {
      if (String(url).endsWith('/token')) return json({ access_token: 'token_result_error', expires_in: 3600 });
      return json({ result: { isError: true, content: [{ type: 'text', text: 'denied' }] } });
    });

    await expect(client.query({ query: 'refund' })).rejects.toThrow('gbrain query returned an error');
  });

  it('throws with parsed details on HTTP failures', async () => {
    const client = clientWithFetch(async (url: string | URL | Request) => {
      if (String(url).endsWith('/token')) return json({ access_token: 'token_http_error', expires_in: 3600 });
      return json({ message: 'downstream unavailable' }, 503);
    });

    await expect(client.query({ query: 'refund' })).rejects.toMatchObject({
      name: 'GbrainHttpError',
      status: 503,
      details: { message: 'downstream unavailable' },
    });
  });

  it('rejects missing secrets and invalid token responses', async () => {
    const missingSecret = new GbrainClient({
      workspaceId: 'workspace-missing-secret',
      baseUrl: 'http://brain.internal',
      oauthClientId: 'client_missing',
    });

    await expect(missingSecret.getAccessToken()).rejects.toThrow('workspace is missing encrypted gbrain client secret');

    const invalidToken = clientWithFetch(async () => json({ expires_in: 3600 }));

    await expect(invalidToken.getAccessToken()).rejects.toThrow('gbrain token response missing access_token');
  });

  it('throws when DCR registration fails or returns incomplete credentials', async () => {
    await expect(
      registerGbrainOAuthClient(
        'http://brain/',
        vi.fn(async () => json({ client_id: 'client_only' }, 400)) as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(GbrainHttpError);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWithFetch(fetchMock: typeof fetch): GbrainClient {
  return new GbrainClient(
    {
      workspaceId: `workspace-${crypto.randomUUID()}`,
      baseUrl: 'http://brain.internal',
      oauthClientId: 'client_test',
      oauthClientSecret: 'secret_test',
    },
    { fetch: fetchMock },
  );
}
