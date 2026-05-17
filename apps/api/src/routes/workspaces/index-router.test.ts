import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks. The router under test calls:
//   - `readSession` for GET/POST (so we stub `validateSession` indirectly)
//   - `requireMembership` middleware for POST /:id/switch
//
// We stub `validateSession` so `readSession` returns deterministic data, and
// we replace `requireMembership` so each test drives the auth state via
// `middlewareMocks.impl` (mirrors the members/invites test pattern).
const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPEN42_EDITION = 'community';
  process.env.OPEN42_ALLOW_MULTI_WORKSPACE = 'false';
});

vi.mock('../../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));

const middlewareMocks = vi.hoisted(() => ({
  impl: (req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role: 'owner' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  },
}));

vi.mock('../../middleware/require-membership.js', () => ({
  requireMembership: () => (req: Request, res: Response, next: NextFunction) =>
    middlewareMocks.impl(req, res, next),
}));

import { buildWorkspaceIndexRouter, type IndexRouterRepo } from './index-router.js';

function denyWith(status: 401 | 403, code: string) {
  middlewareMocks.impl = (_req, res, _next) => {
    res.status(status).json({ error: code });
  };
}

function allowAs(userId: string, role: 'owner' | 'admin' | 'member' = 'owner') {
  middlewareMocks.impl = (req, _res, next) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role };
    req.session = { id: 'sess', userId };
    next();
  };
}

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

function makeRepo(overrides: Partial<IndexRouterRepo> = {}): IndexRouterRepo {
  return {
    listMembershipsForUser: vi.fn(async () => []),
    setCurrentWorkspace: vi.fn(async () => {}),
    findWorkspace: vi.fn(async () => null),
    countActiveWorkspaces: vi.fn(async () => 0),
    ...overrides,
  };
}

function makeApp(
  opts: {
    repo?: IndexRouterRepo;
    createWorkspaceForUser?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/workspaces',
    buildWorkspaceIndexRouter({
      repo: opts.repo ?? makeRepo(),
      createWorkspaceForUser: opts.createWorkspaceForUser as never,
    }),
  );
  return app;
}

const COOKIE = 'open42_session=session-1';

beforeEach(() => {
  mocks.validateSession.mockReset();
  middlewareMocks.impl = (req, _res, next) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role: 'owner' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  };
});

describe('workspace index router', () => {
  describe('GET /workspaces', () => {
    it('401 when no session', async () => {
      const res = await request(makeApp()).get('/workspaces');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });

    it('returns memberships (owner + joined) for the caller', async () => {
      setSession('user-1');
      const repo = makeRepo({
        listMembershipsForUser: vi.fn(async () => [
          { id: 'ws-owner', name: 'My WS', role: 'owner' as const, status: 'ready' as const },
          { id: 'ws-joined', name: 'Their WS', role: 'member' as const, status: 'ready' as const },
        ]),
      });
      const res = await request(makeApp({ repo })).get('/workspaces').set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.listMembershipsForUser).toHaveBeenCalledWith('user-1');
      expect(res.body.workspaces).toHaveLength(2);
      expect(res.body.workspaces[0]).toMatchObject({
        id: 'ws-owner',
        role: 'owner',
        status: 'ready',
      });
      expect(res.body.workspaces[1]).toMatchObject({ id: 'ws-joined', role: 'member' });
    });

    it('returns empty array when caller has no memberships', async () => {
      setSession('user-1');
      const repo = makeRepo({ listMembershipsForUser: vi.fn(async () => []) });
      const res = await request(makeApp({ repo })).get('/workspaces').set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ workspaces: [], allowMultiWorkspace: false });
    });
  });

  describe('POST /workspaces', () => {
    it('401 when no session', async () => {
      const res = await request(makeApp()).post('/workspaces').send({ name: 'New WS' });
      expect(res.status).toBe(401);
    });

    it('400 when name is missing/blank/too long', async () => {
      setSession('user-1');
      const create = vi.fn();
      const blank = await request(makeApp({ createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({ name: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body).toEqual({ error: 'workspace_name_invalid' });

      const tooLong = await request(makeApp({ createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({ name: 'x'.repeat(81) });
      expect(tooLong.status).toBe(400);

      const missing = await request(makeApp({ createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({});
      expect(missing.status).toBe(400);

      expect(create).not.toHaveBeenCalled();
    });

    it('201 — calls createWorkspaceForUser and returns the workspace', async () => {
      setSession('user-1');
      const create = vi.fn(async (userId: string, name: string) => ({
        id: 'ws-new',
        name,
        status: 'provisioning' as const,
      }));
      const res = await request(makeApp({ createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({ name: '  New   Workspace  ' });
      expect(res.status).toBe(201);
      expect(create).toHaveBeenCalledWith('user-1', 'New Workspace');
      expect(res.body).toEqual({
        workspace: { id: 'ws-new', name: 'New Workspace', status: 'provisioning' },
      });
    });

    it('403 when cloud owner signup is not authorized', async () => {
      setSession('user-1');
      const create = vi.fn(async () => {
        throw new Error('owner_signup_not_allowed');
      });

      const res = await request(makeApp({ createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({ name: 'Blocked Workspace' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'owner_signup_not_allowed' });
    });

    it('403 when community single-workspace mode already has an active workspace', async () => {
      setSession('user-1');
      const repo = makeRepo({ countActiveWorkspaces: vi.fn(async () => 1) });
      const create = vi.fn(async (userId: string, name: string) => ({
        id: 'ws-2',
        name,
        status: 'provisioning' as const,
      }));
      const res = await request(makeApp({ repo, createWorkspaceForUser: create }))
        .post('/workspaces')
        .set('Cookie', COOKIE)
        .send({ name: 'Second WS' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'multi_workspace_disabled' });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('POST /workspaces/:id/switch', () => {
    it('401 when no session', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp()).post('/workspaces/ws-1/switch');
      expect(res.status).toBe(401);
    });

    it('403 when caller is not a member', async () => {
      denyWith(403, 'workspace_membership_required');
      const res = await request(makeApp()).post('/workspaces/ws-1/switch').set('Cookie', COOKIE);
      expect(res.status).toBe(403);
    });

    it('200 — sets current_workspace_id and returns the workspace row', async () => {
      allowAs('user-1', 'member');
      const repo = makeRepo({
        findWorkspace: vi.fn(async () => ({
          id: 'ws-1',
          name: 'Speedrun',
          status: 'ready' as const,
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/switch')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.setCurrentWorkspace).toHaveBeenCalledWith('user-1', 'ws-1');
      expect(res.body).toEqual({
        ok: true,
        workspace: { id: 'ws-1', name: 'Speedrun', status: 'ready' },
      });
    });

    it('404 when the workspace was soft-deleted between gate and handler', async () => {
      allowAs('user-1', 'owner');
      const repo = makeRepo({ findWorkspace: vi.fn(async () => null) });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-gone/switch')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'workspace_not_found' });
      expect(repo.setCurrentWorkspace).not.toHaveBeenCalled();
    });
  });
});
