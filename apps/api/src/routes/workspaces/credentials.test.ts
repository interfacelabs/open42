/**
 * Workspace credentials route tests — BYOK Lane E3.
 *
 * Covers:
 *   a. 401 with no session
 *   b. 403 when caller has no membership in the target workspace
 *   c. 403 forbidden_owner_only when caller is a member but not owner
 *      (round-8 P1: route is owner-only; admin/member must be rejected)
 *   d. POST with invalid provider → 400
 *   e. POST with (anthropic, embed) → 400 unsupported_provider_scope
 *   f. POST happy path — calls upsertLlmKey with the right args
 *   g. GET shape — never includes the secret
 *   h. DELETE happy path
 *   i. DELETE on non-existent row → 200 (idempotent)
 *
 * The route is mounted at `/workspaces/:id/credentials` and protected by
 * `requireRole(['owner'], { from: 'param' }, 'forbidden_owner_only')` — which
 * internally chains `requireMembership` first then asserts `role==='owner'`.
 * We stub the membership middleware here so the tests can drive the
 * credentials router directly without provisioning a real session+membership
 * row in the DB (the round-trip path is covered by auth/llm-keys.test.ts and
 * middleware/require-membership.test.ts). The test app reproduces the
 * production wiring by calling `requireRole(['owner'], ...)` at the mount.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // Per-test override: default lets requests through with a fixed workspace.
  // Tests that exercise the 401 / 403 branches swap `impl` in beforeEach.
  impl: (req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: WORKSPACE_ID_PLACEHOLDER, role: 'owner' };
    req.session = { id: 'sess-credentials-test', userId: 'user-credentials-test' };
    next();
  },
  upsertLlmKey: vi.fn(),
  deleteLlmKey: vi.fn(),
}));

// `vi.mock` is hoisted above `const` declarations, so we can't read constants
// from this file inside the factory. The middleware mock reads the workspace
// id off a sentinel that's filled at test-build time.
const WORKSPACE_ID_PLACEHOLDER = '11111111-1111-4111-8111-111111111111';

vi.mock('../../middleware/require-membership.js', () => ({
  requireMembership: () => (req: Request, res: Response, next: NextFunction) =>
    mocks.impl(req, res, next),
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
const { requireRole } = await import('../../middleware/require-role.js');

const WORKSPACE_ID = WORKSPACE_ID_PLACEHOLDER;
const PATH = `/workspaces/${WORKSPACE_ID}/credentials`;

function buildApp(deps?: Parameters<typeof buildWorkspaceCredentialsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/workspaces/:id/credentials',
    requireRole(['owner'], { from: 'param' }, 'forbidden_owner_only'),
    buildWorkspaceCredentialsRouter(deps),
  );
  return app;
}

function authedRequest(app: express.Express, method: 'get' | 'post' | 'delete') {
  return request(app)[method](PATH);
}

beforeEach(() => {
  // Reset to the "allow" middleware. Tests override per-case below.
  mocks.impl = (req, _res, next) => {
    req.workspace = { id: WORKSPACE_ID, role: 'owner' };
    req.session = { id: 'sess-credentials-test', userId: 'user-credentials-test' };
    next();
  };
  mocks.upsertLlmKey.mockReset();
  mocks.deleteLlmKey.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('workspace credentials route — auth gates', () => {
  it('returns 401 with no session', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(401).json({ error: 'unauthorized' });
    };
    const app = buildApp();

    const res = await request(app).get(PATH);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not a member of the target workspace', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(403).json({ error: 'workspace_membership_required' });
    };
    const app = buildApp();

    const res = await authedRequest(app, 'get');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workspace_membership_required' });
  });

  // Round-8 P1: BYOK credential routes must require role=owner. Pre-fix the
  // route was gated on `requireMembership`, so any member (including plain
  // 'member' or 'admin') could view, add, or delete provider keys for the
  // workspace owner — a billing-sensitive privilege escalation.
  it('GET returns 403 forbidden_owner_only when caller is admin', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'admin' };
      req.session = { id: 'sess-admin', userId: 'user-admin' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'get');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
  });

  it('GET returns 403 forbidden_owner_only when caller is member', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'member' };
      req.session = { id: 'sess-member', userId: 'user-member' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'get');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
  });

  it('POST returns 403 forbidden_owner_only when caller is admin and never calls upsertLlmKey', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'admin' };
      req.session = { id: 'sess-admin', userId: 'user-admin' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-xxxx',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('POST returns 403 forbidden_owner_only when caller is member and never calls upsertLlmKey', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'member' };
      req.session = { id: 'sess-member', userId: 'user-member' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-xxxx',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('DELETE returns 403 forbidden_owner_only when caller is admin and never calls deleteLlmKey', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'admin' };
      req.session = { id: 'sess-admin', userId: 'user-admin' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'openai',
      scope: 'chat',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
    expect(mocks.deleteLlmKey).not.toHaveBeenCalled();
  });

  it('DELETE returns 403 forbidden_owner_only when caller is member and never calls deleteLlmKey', async () => {
    mocks.impl = (req, _res, next) => {
      req.workspace = { id: WORKSPACE_ID, role: 'member' };
      req.session = { id: 'sess-member', userId: 'user-member' };
      next();
    };
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'openai',
      scope: 'chat',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_owner_only' });
    expect(mocks.deleteLlmKey).not.toHaveBeenCalled();
  });

  it('POST returns 401 with no session and never calls upsertLlmKey', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(401).json({ error: 'unauthorized' });
    };
    const app = buildApp();

    const res = await request(app)
      .post(PATH)
      .send({ provider: 'openai', scope: 'chat', apiKey: 'sk-xxxx' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('POST returns 403 when caller is not a member of the target workspace', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(403).json({ error: 'workspace_membership_required' });
    };
    const app = buildApp();

    const res = await authedRequest(app, 'post').send({
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-xxxx',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workspace_membership_required' });
    expect(mocks.upsertLlmKey).not.toHaveBeenCalled();
  });

  it('DELETE returns 401 with no session and never calls deleteLlmKey', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(401).json({ error: 'unauthorized' });
    };
    const app = buildApp();

    const res = await request(app)
      .delete(PATH)
      .send({ provider: 'openai', scope: 'chat' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.deleteLlmKey).not.toHaveBeenCalled();
  });

  it('DELETE returns 403 when caller is not a member of the target workspace', async () => {
    mocks.impl = (_req, res, _next) => {
      res.status(403).json({ error: 'workspace_membership_required' });
    };
    const app = buildApp();

    const res = await authedRequest(app, 'delete').send({
      provider: 'openai',
      scope: 'chat',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workspace_membership_required' });
    expect(mocks.deleteLlmKey).not.toHaveBeenCalled();
  });
});

describe('POST /workspaces/:id/credentials', () => {
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

describe('GET /workspaces/:id/credentials', () => {
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

describe('DELETE /workspaces/:id/credentials', () => {
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
