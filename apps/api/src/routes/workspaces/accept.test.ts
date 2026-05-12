import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks. The accept router does NOT go through `requireMembership` /
// `requireRole` — the caller may not yet be a member of the workspace they
// are accepting an invite for (that membership row is what we're about to
// create). The only auth gate is the session cookie itself, read via
// `readSession` which delegates to `validateSession`.
const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
}));

vi.mock('../../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));

import { buildAcceptRouter, type AcceptRouterRepo, type AcceptResult } from './accept.js';

function setSession(userId: string | null) {
  if (userId === null) {
    mocks.validateSession.mockResolvedValue(null);
  } else {
    mocks.validateSession.mockResolvedValue({
      id: 'sess-1',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      csrfToken: 'csrf',
      userAgent: null,
      ipFirstOctet: null,
    });
  }
}

function makeRepo(overrides: Partial<AcceptRouterRepo> = {}): AcceptRouterRepo {
  return {
    acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'not_found' })),
    ...overrides,
  };
}

function makeApp(repo: AcceptRouterRepo = makeRepo()) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/workspaces', buildAcceptRouter({ repo }));
  return app;
}

const COOKIE = 'open42_session=session-1';

beforeEach(() => {
  mocks.validateSession.mockReset();
});

describe('POST /workspaces/invites/:inviteId/accept', () => {
  it('401 when no session', async () => {
    setSession(null);
    const repo = makeRepo();
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(repo.acceptInvite).not.toHaveBeenCalled();
  });

  it('404 when invite does not exist', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'not_found' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/missing/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'invite_not_found' });
    expect(repo.acceptInvite).toHaveBeenCalledWith('missing', 'user-1');
  });

  it('404 when workspace soft-deleted', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'workspace_not_found' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'workspace_not_found' });
  });

  it('403 invite_email_mismatch when session email differs from invite email', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'email_mismatch' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'invite_email_mismatch' });
  });

  it('409 invite_revoked when invite.status = revoked', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'revoked' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invite_revoked' });
  });

  it('409 invite_already_accepted when invite already accepted by a DIFFERENT user', async () => {
    setSession('user-1');
    // The repo returns `already_accepted` only when (a) invite is accepted and
    // (b) the caller is not already a member. If the caller WAS already a
    // member, the repo would return `ok` from the already-member branch first.
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'already_accepted' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invite_already_accepted' });
  });

  it('200 idempotent when caller is already a member (regardless of invite status)', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({
        kind: 'ok',
        workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
      })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
    });
  });

  it('400 invite_expired when created_at older than 24h', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'expired' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invite_expired' });
  });

  it('200 happy path — inserts membership, marks accepted, sets current_workspace_id', async () => {
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({
        kind: 'ok',
        workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
      })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
    });
    expect(repo.acceptInvite).toHaveBeenCalledWith('inv-1', 'user-1');
  });

  it('200 idempotent re-click — second call returns ok too (ON CONFLICT DO NOTHING)', async () => {
    // Two successive acceptInvite calls — both return ok. The repo is what
    // enforces ON CONFLICT DO NOTHING + idempotent already-member branch; the
    // router only asks; this test pins the router's contract that a repeated
    // call yields a stable 200.
    setSession('user-1');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({
        kind: 'ok',
        workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
      })),
    });
    const app = makeApp(repo);
    const first = await request(app)
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(first.status).toBe(200);

    setSession('user-1'); // session cookie revalidates per-call
    const second = await request(app)
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(second.status).toBe(200);
    expect(repo.acceptInvite).toHaveBeenCalledTimes(2);
  });

  it('401 unauthorized when session refers to a deleted/missing user', async () => {
    // Session validates, but by the time the repo runs the users row is gone.
    // The repo signals this with `user_not_found`; the router maps it to 401.
    setSession('user-ghost');
    const repo = makeRepo({
      acceptInvite: vi.fn(async (): Promise<AcceptResult> => ({ kind: 'user_not_found' })),
    });
    const res = await request(makeApp(repo))
      .post('/workspaces/invites/inv-1/accept')
      .set('Cookie', COOKIE);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });
});
