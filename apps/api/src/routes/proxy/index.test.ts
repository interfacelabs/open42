import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAnthropicProxy, buildOpenAIProxy } from './index.js';

/**
 * Stub resolver that mimics the env-fallback path of the real `resolveLlmKey`.
 * We use this in tests that previously asserted the env key was forwarded
 * upstream, to keep that assertion meaningful without depending on the DB.
 */
function sharedResolver(apiKey: string) {
  return vi.fn(async () => ({ apiKey, source: 'shared' as const, model: null }));
}

describe('LLM egress proxy routes', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    logger.info.mockReset();
    logger.error.mockReset();
  });

  it('authenticates an OpenAI proxy token, swaps upstream auth, and streams headers/body', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': '5',
          'X-RateLimit-Remaining-Requests': '10',
          Connection: 'upstream-close',
          'Transfer-Encoding': 'chunked',
          'Content-Encoding': 'gzip',
          'Content-Length': '999',
        },
      }),
    );
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        now: () => 1000,
        verifyProxyToken: async (token) =>
          token === 'tnt_workspace_abc' ? { workspaceId: 'workspace-abc' } : null,
        resolveLlmKey: sharedResolver('upstream-openai'),
      }),
    );

    const res = await request(app)
      .post('/v1/chat/completions?stream=true')
      .set('Authorization', 'Bearer tnt_workspace_abc')
      .set('x-api-key', 'incoming-should-not-forward')
      .set('Content-Type', 'application/json')
      .set('Accept', 'text/event-stream')
      .set('User-Agent', 'proxy-test')
      .send('{"model":"gpt-test"}');

    expect(res.status).toBe(200);
    expect(res.text).toBe('{"ok":true}');
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['retry-after']).toBe('5');
    expect(res.headers['x-ratelimit-remaining-requests']).toBe('10');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).not.toBe('999');
    expect(res.headers.connection).not.toBe('upstream-close');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/chat/completions?stream=true');
    expect(init?.method).toBe('POST');
    expect(Buffer.from(init?.body as Uint8Array).toString('utf8')).toBe('{"model":"gpt-test"}');
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer upstream-openai');
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('content-type')).toContain('application/json');
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('user-agent')).toBe('proxy-test');
    expect(logger.info).toHaveBeenCalledWith({
      workspaceId: 'workspace-abc',
      route: '/v1/chat/completions',
      status: 200,
      keySource: 'shared',
      durationMs: 0,
    });
  });

  it('accepts Anthropic x-api-key tenant auth and inserts Anthropic upstream headers', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('ok', { status: 201 }),
    );
    const app = express().use(
      buildAnthropicProxy({
        env: { ANTHROPIC_API_KEY: 'upstream-anthropic' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        verifyProxyToken: async (token) =>
          token === 'tnt_workspace_xyz' ? { workspaceId: 'workspace-xyz' } : null,
        resolveLlmKey: sharedResolver('upstream-anthropic'),
      }),
    );

    const res = await request(app)
      .post('/v1/messages')
      .set('x-api-key', 'tnt_workspace_xyz')
      .set('Authorization', 'Bearer incoming-should-not-forward')
      .send('{"messages":[]}');

    expect(res.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Headers;
    expect(headers.get('x-api-key')).toBe('upstream-anthropic');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
  });

  it('returns 404 for provider endpoints outside the allowlist', async () => {
    const fetchMock = vi.fn();
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey: sharedResolver('upstream-openai'),
      }),
    );

    const res = await request(app)
      .post('/v1/files')
      .set('Authorization', 'Bearer tnt_workspace_abc')
      .send('{}');

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 405 when an allowlisted path is called with a disallowed method', async () => {
    const fetchMock = vi.fn();
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey: sharedResolver('upstream-openai'),
      }),
    );

    // /v1/chat/completions is POST-only
    const getRes = await request(app)
      .get('/v1/chat/completions')
      .set('Authorization', 'Bearer tnt_workspace_abc');
    expect(getRes.status).toBe(405);
    expect(getRes.headers['allow']).toBe('POST');
    expect(fetchMock).not.toHaveBeenCalled();

    // DELETE on POST-only path
    const delRes = await request(app)
      .delete('/v1/embeddings')
      .set('Authorization', 'Bearer tnt_workspace_abc');
    expect(delRes.status).toBe(405);

    // POST on /v1/models (GET-only) is also rejected
    const postModels = await request(app)
      .post('/v1/models')
      .set('Authorization', 'Bearer tnt_workspace_abc');
    expect(postModels.status).toBe(405);
    expect(postModels.headers['allow']).toBe('GET');

    // Sanity: GET on /v1/models works (would call upstream)
    fetchMock.mockResolvedValueOnce(
      new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const ok = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer tnt_workspace_abc');
    expect(ok.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the resolver finds neither a tenant key nor an env fallback', async () => {
    const fetchMock = vi.fn();
    const app = express().use(
      buildOpenAIProxy({
        env: {} as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey: vi.fn(async () => null),
      }),
    );

    const res = await request(app)
      .post('/v1/embeddings')
      .set('Authorization', 'Bearer tnt_workspace_abc')
      .send('{}');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'upstream_key_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the tenant BYOK key over the shared env fallback when both exist', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('{"ok":true}', { status: 200 }),
    );
    const resolveLlmKey = vi.fn(async () => ({
      apiKey: 'tenant-real-key',
      source: 'tenant' as const,
      model: 'gpt-5-1',
    }));
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai-shared' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        now: () => 0,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey,
      }),
    );

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer tnt_workspace_abc')
      .send('{}');

    expect(res.status).toBe(200);
    expect(resolveLlmKey).toHaveBeenCalledWith(
      { workspaceId: 'workspace-abc', provider: 'openai', scope: 'chat' },
      expect.any(Object),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tenant-real-key');
    expect(headers.get('authorization')).not.toContain('upstream-openai-shared');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-abc',
        keySource: 'tenant',
      }),
    );
  });

  it('falls back to the shared env key when the resolver reports source=shared', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('ok', { status: 200 }),
    );
    const resolveLlmKey = vi.fn(async () => ({
      apiKey: 'env-shared-key',
      source: 'shared' as const,
      model: null,
    }));
    const app = express().use(
      buildAnthropicProxy({
        env: { ANTHROPIC_API_KEY: 'env-shared-key' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        now: () => 0,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-xyz' }),
        resolveLlmKey,
      }),
    );

    const res = await request(app)
      .post('/v1/messages')
      .set('x-api-key', 'tnt_workspace_xyz')
      .send('{}');

    expect(res.status).toBe(200);
    expect(resolveLlmKey).toHaveBeenCalledWith(
      { workspaceId: 'workspace-xyz', provider: 'anthropic', scope: 'chat' },
      expect.any(Object),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get('x-api-key')).toBe('env-shared-key');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-xyz',
        keySource: 'shared',
      }),
    );
  });

  it('returns 503 without calling upstream when the resolver returns null', async () => {
    const fetchMock = vi.fn();
    const resolveLlmKey = vi.fn(async () => null);
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'env-shared-key' } as NodeJS.ProcessEnv,
        fetch: fetchMock as typeof fetch,
        logger,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey,
      }),
    );

    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer tnt_workspace_abc')
      .send('{}');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'upstream_key_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveLlmKey).toHaveBeenCalledTimes(1);
  });

  it('rate limits repeated failed tenant auth attempts', async () => {
    const verifyProxyToken = vi.fn(async () => null);
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai' } as NodeJS.ProcessEnv,
        fetch: vi.fn() as unknown as typeof fetch,
        logger,
        now: () => 0,
        verifyProxyToken,
        resolveLlmKey: sharedResolver('upstream-openai'),
      }),
    );

    for (let i = 0; i < 30; i += 1) {
      await request(app)
        .get('/v1/models')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    }

    const limited = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer invalid-token');

    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('300');
    expect(verifyProxyToken).toHaveBeenCalledTimes(30);
  });

  it('propagates upstream streaming errors by aborting the client response', async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
        queueMicrotask(() => controller.error(new Error('upstream stream failed')));
      },
    });
    const app = express().use(
      buildOpenAIProxy({
        env: { OPENAI_API_KEY: 'upstream-openai' } as NodeJS.ProcessEnv,
        fetch: vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(upstreamBody, { status: 200 }),
        ) as unknown as typeof fetch,
        logger,
        verifyProxyToken: async () => ({ workspaceId: 'workspace-abc' }),
        resolveLlmKey: sharedResolver('upstream-openai'),
      }),
    );

    await expect(
      new Promise((resolve, reject) => {
        request(app)
          .post('/v1/chat/completions')
          .set('Authorization', 'Bearer tnt_workspace_abc')
          .send('{}')
          .end((err, res) => (err ? reject(err) : resolve(res)));
      }),
    ).rejects.toBeTruthy();
  });
});
