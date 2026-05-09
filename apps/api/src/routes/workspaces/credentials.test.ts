/**
 * Workspace credentials route tests — BYOK Lane E3.
 *
 * Covers:
 *   a. 401 with no session
 *   b. 403 when session has no owned workspace
 *   c. POST with invalid provider → 400
 *   d. POST with (anthropic, embed) → 400 unsupported_provider_scope
 *   e. POST happy path — calls upsertLlmKey with the right args
 *   f. GET shape — never includes the secret
 *   g. DELETE happy path
 *   h. DELETE on non-existent row → 200 (idempotent)
 *
 * Routes are exercised via supertest against a mock-wired router. The DB
 * round-trip path is covered separately by auth/llm-keys.test.ts (gated on
 * DATABASE_URL); these tests focus on the HTTP contract — auth, validation,
 * response shape, and "secret never escapes" assertions.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  resolveOwnerWorkspaceId: vi.fn(),
  upsertLlmKey: vi.fn(),
  deleteLlmKey: vi.fn(),
}));

vi.mock('../../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));
vi.mock('../../auth/membership.js', () => ({
  resolveOwnerWorkspaceId: mocks.resolveOwnerWorkspaceId,
}));
vi.mock('../../auth/llm-keys.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../auth/llm-keys.js')
  >('../../auth/llm-keys.js');
  return {
    ...actual,
    upsertLlmKey: mocks.upsertLlmKey,
    deleteLlmKey: mocks.deleteLlmKey,
  };
});

const { buildWorkspaceCredentialsRouter } = await import('./credentials.js');

const SESSION_ID = 'sess-credentials-test';
const USER_ID = 'user-credentials-test';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function buildApp(deps?: Parameters<typeof buildWorkspaceCredentialsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/workspaces/credentials', buildWorkspaceCredentialsRouter(deps));
  return app;
}

function authedRequest(app: express.Express, method: 'get' | 'post' | 'delete') {
  return request(app)
    [method]('/workspaces/credentials')
    .set('Cookie', `open42_session=${SESSION_ID}`);
}

beforeEach(() => {
  mocks.validateSession.mockReset();
  mocks.resolveOwnerWorkspaceId.mockReset();
  mocks.upsertLlmKey.mockReset();
  mocks.deleteLlmKey.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('workspace credentials route — auth gates', () => {
  it('returns 401 with no session', async () => {
    mocks.validateSession.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get('/workspaces/credentials');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.resolveOwnerWorkspaceId).not.toHaveBeenCalled();
  });

  it('returns 403 when the session has no owned workspace', async () => {
    mocks.validateSession.mockResolvedValue({ userId: USER_ID });
    mocks.resolveOwnerWorkspaceId.mockResolvedValue(null);
    const app = buildApp();

    const res = await authedRequest(app, 'get');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'no_workspace' });
  });
});

describe('POST /workspaces/credentials', () => {
  beforeEach(() => {
    mocks.validateSession.mockResolvedValue({ userId: USER_ID });
    mocks.resolveOwnerWorkspaceId.mockResolvedValue(WORKSPACE_ID);
  });

  it('rejects invalid provider with 400', async () => {
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'cohere',
      scope: 'chat',
      apiKey: 'sk-x',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_provider_scope' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('rejects invalid scope with 400', async () => {
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'audio',
      apiKey: 'sk-x',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_provider_scope' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('rejects (anthropic, embed) with unsupported_provider_scope', async () => {
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'anthropic',
      scope: 'embed',
      apiKey: 'sk-anthropic-1',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_provider_scope',
      detail: 'anthropic_has_no_embedding_api',
    });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('rejects empty / oversized api key with 400', async () => {
    const app = buildApp();

    const empty = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: '   ',
    });
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ error: 'invalid_api_key' });

    const huge = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'x'.repeat(257),
    });
    expect(huge.status).toBe(400);
    expect(huge.body).toEqual({ error: 'invalid_api_key' });

    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('rejects an oversized model with 400', async () => {
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-good',
      model: 'm'.repeat(101),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_model' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('happy path: returns 200 { ok, source } and forwards trimmed args to upsertLlmKey', async () => {
    mocks.upsertLlmKey.mockResolvedValue(undefined);
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: '  sk-tenant-xyz  ',
      model: '  gpt-5-mini  ',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, source: 'tenant' });
    expect(mocks.upsertLlmKey).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLlmKey).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-tenant-xyz',
      model: 'gpt-5-mini',
    });
  });

  it('happy path with model omitted: forwards model: null', async () => {
    mocks.upsertLlmKey.mockResolvedValue(undefined);
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'embed',
      apiKey: 'sk-embed-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, source: 'tenant' });
    expect(mocks.upsertLlmKey).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      provider: 'openai',
      scope: 'embed',
      apiKey: 'sk-embed-1',
      model: null,
    });
  });
});

describe('GET /workspaces/credentials', () => {
  beforeEach(() => {
    mocks.validateSession.mockResolvedValue({ userId: USER_ID });
    mocks.resolveOwnerWorkspaceId.mockResolvedValue(WORKSPACE_ID);
  });

  it('returns the configured (provider, scope) tuples without exposing the secret', async () => {
    const fakeRows = [
      {
        provider: 'openai',
        scope: 'chat',
        model: 'gpt-5-mini',
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        provider: 'openai',
        scope: 'embed',
        model: null,
        createdAt: new Date('2026-05-02T00:00:00Z'),
      },
    ];
    const where = vi.fn(async () => fakeRows);
    const from = vi.fn(() => ({ where }));
    // Capture the selection projection — proves the route never asks for the secret.
    const select = vi.fn((projection: Record<string, unknown>) => {
      capturedProjection = projection;
      return { from };
    });
    let capturedProjection: Record<string, unknown> | null = null;
    const fakeDb = { select } as unknown as Parameters<
      typeof buildWorkspaceCredentialsRouter
    >[0] extends infer X ? X extends { db?: infer D } ? D : never : never;

    const app = buildApp({ db: fakeDb });
    const res = await authedRequest(app, 'get');

    expect(res.status).toBe(200);
    // Body must not contain the secret or anything derived from it.
    expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    expect(JSON.stringify(res.body)).not.toMatch(/ciphertext/i);
    expect(res.body.credentials).toHaveLength(2);
    expect(res.body.credentials[0]).toMatchObject({
      provider: 'openai',
      scope: 'chat',
      model: 'gpt-5-mini',
    });
    // The route must NOT include secretCiphertext in the projection.
    expect(capturedProjection).not.toBeNull();
    expect(Object.keys(capturedProjection!)).toEqual([
      'provider',
      'scope',
      'model',
      'createdAt',
    ]);
    expect(Object.keys(capturedProjection!)).not.toContain('secretCiphertext');
  });
});

describe('DELETE /workspaces/credentials', () => {
  beforeEach(() => {
    mocks.validateSession.mockResolvedValue({ userId: USER_ID });
    mocks.resolveOwnerWorkspaceId.mockResolvedValue(WORKSPACE_ID);
  });

  it('happy path: returns 200 and forwards args to deleteLlmKey', async () => {
    mocks.deleteLlmKey.mockResolvedValue(undefined);
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'openai',
      scope: 'chat',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.deleteLlmKey).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      provider: 'openai',
      scope: 'chat',
    });
  });

  it('idempotent: returns 200 even when no row exists (deleteLlmKey is a no-op)', async () => {
    // Mirror the real helper: it issues the DELETE unconditionally, which is
    // a no-op when no row matches. The route should still return 200.
    mocks.deleteLlmKey.mockResolvedValue(undefined);
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'anthropic',
      scope: 'chat',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.deleteLlmKey).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid provider with 400', async () => {
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'cohere',
      scope: 'chat',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_provider_scope' });
    expect(mocks.deleteLlmKey).not.toHaveBeenCalled();
  });
});
