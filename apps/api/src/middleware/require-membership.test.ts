import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWorkspaceMembership: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock('../auth/membership.js', () => ({
  assertWorkspaceMembership: mocks.assertWorkspaceMembership,
}));

vi.mock('../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));

import { requireMembership } from './require-membership.js';

function makeApp(opts: Parameters<typeof requireMembership>[0]) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.post('/test/:id?', requireMembership(opts), (req, res) => {
    res.json({
      workspace: (req as express.Request & { workspace?: unknown; session?: unknown }).workspace,
      session: (req as express.Request & { session?: unknown }).session,
    });
  });
  app.get('/test', requireMembership(opts), (req, res) => {
    res.json({ workspace: (req as express.Request & { workspace?: unknown }).workspace });
  });
  return app;
}

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'open42_session';

describe('requireMembership', () => {
  beforeEach(() => {
    mocks.assertWorkspaceMembership.mockReset();
    mocks.validateSession.mockReset();
  });

  it('401 when no session cookie', async () => {
    const app = makeApp({ from: 'body' });
    const res = await request(app).post('/test').send({ workspace_id: 'w1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.validateSession).not.toHaveBeenCalled();
  });

  it('401 when session cookie present but validateSession returns null', async () => {
    mocks.validateSession.mockResolvedValue(null);
    const app = makeApp({ from: 'body' });
    const res = await request(app)
      .post('/test')
      .set('Cookie', `${SESSION_COOKIE}=bad-session`)
      .send({ workspace_id: 'w1' });
    expect(res.status).toBe(401);
  });

  it('400 when workspace_id missing (from=body)', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    const app = makeApp({ from: 'body' });
    const res = await request(app)
      .post('/test')
      .set('Cookie', `${SESSION_COOKIE}=ok`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'workspace_id_required' });
  });

  it('400 when workspace_id missing (from=param)', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    const app = makeApp({ from: 'param' });
    const res = await request(app).post('/test').set('Cookie', `${SESSION_COOKIE}=ok`);
    expect(res.status).toBe(400);
  });

  it('400 when workspace_id missing (from=query)', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    const app = makeApp({ from: 'query' });
    const res = await request(app).get('/test').set('Cookie', `${SESSION_COOKIE}=ok`);
    expect(res.status).toBe(400);
  });

  it('403 when not a member', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    mocks.assertWorkspaceMembership.mockRejectedValue(
      Object.assign(new Error('forbidden'), { status: 403, code: 'forbidden_no_membership' }),
    );
    const app = makeApp({ from: 'body' });
    const res = await request(app)
      .post('/test')
      .set('Cookie', `${SESSION_COOKIE}=ok`)
      .send({ workspace_id: 'w1' });
    expect(res.status).toBe(403);
  });

  it('attaches req.workspace AND req.session on success', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    mocks.assertWorkspaceMembership.mockResolvedValue({ role: 'owner' });
    const app = makeApp({ from: 'body' });
    const res = await request(app)
      .post('/test')
      .set('Cookie', `${SESSION_COOKIE}=ok`)
      .send({ workspace_id: 'w1' });
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'w1', role: 'owner' });
    expect(res.body.session).toEqual({ id: 's1', userId: 'u1' });
  });

  it('reads workspace id from URL param when from=param', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    mocks.assertWorkspaceMembership.mockResolvedValue({ role: 'member' });
    const app = makeApp({ from: 'param' });
    const res = await request(app).post('/test/ws-123').set('Cookie', `${SESSION_COOKIE}=ok`);
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-123', role: 'member' });
  });

  it('reads workspace id from query when from=query', async () => {
    mocks.validateSession.mockResolvedValue({ id: 's1', userId: 'u1' });
    mocks.assertWorkspaceMembership.mockResolvedValue({ role: 'admin' });
    const app = makeApp({ from: 'query' });
    const res = await request(app)
      .get('/test')
      .set('Cookie', `${SESSION_COOKIE}=ok`)
      .query({ workspace_id: 'ws-456' });
    expect(res.status).toBe(200);
    expect(res.body.workspace).toEqual({ id: 'ws-456', role: 'admin' });
  });
});
