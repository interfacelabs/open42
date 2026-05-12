import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted middleware mocks. The router under test goes through
// `requireMembership` (for GET) and `requireRole` (for PATCH/DELETE). Both
// are mocked here so each test can drive the auth state via
// `middlewareMocks.impl`. Default is "owner allowed"; tests override per-case.
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

vi.mock('../../middleware/require-role.js', () => ({
  requireRole: () => [
    (req: Request, res: Response, next: NextFunction) =>
      middlewareMocks.impl(req, res, next),
  ],
}));

import { buildMembersRouter, type MembersRouterRepo } from './members.js';

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

function makeRepo(overrides: Partial<MembersRouterRepo> = {}): MembersRouterRepo {
  return {
    listMembers: vi.fn(async () => []),
    findMembership: vi.fn(async () => null),
    updateMembershipRole: vi.fn(async () => {}),
    deleteMembership: vi.fn(async () => {}),
    clearCurrentWorkspaceIfMatches: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeApp(repo: MembersRouterRepo = makeRepo()) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/workspaces', buildMembersRouter({ repo }));
  return app;
}

const COOKIE = 'open42_session=session-1';

beforeEach(() => {
  // Reset middleware to "session present, owner".
  middlewareMocks.impl = (req, _res, next) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role: 'owner' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  };
});

describe('per-workspace member routes', () => {
  describe('GET /workspaces/:id/members', () => {
    it('401 without session', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp()).get('/workspaces/ws-1/members');
      expect(res.status).toBe(401);
    });

    it('200 — any member can list; returns rows', async () => {
      allowAs('user-1', 'member');
      const repo = makeRepo({
        listMembers: vi.fn(async () => [
          {
            userId: 'u',
            email: 'me@example.com',
            role: 'member' as const,
            joinedAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            userId: 'u2',
            email: 'admin@example.com',
            role: 'admin' as const,
            joinedAt: new Date('2026-02-01T00:00:00Z'),
          },
        ]),
      });
      const res = await request(makeApp(repo))
        .get('/workspaces/ws-1/members')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2);
      expect(res.body.members[0]).toMatchObject({
        userId: 'u',
        email: 'me@example.com',
        role: 'member',
      });
    });

    it('403 when caller is not a member', async () => {
      denyWith(403, 'workspace_membership_required');
      const res = await request(makeApp())
        .get('/workspaces/ws-1/members')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /workspaces/:id/members/:userId', () => {
    it('401 without session', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp())
        .patch('/workspaces/ws-1/members/target')
        .send({ role: 'admin' });
      expect(res.status).toBe(401);
    });

    it('403 when caller is a member (cannot manage)', async () => {
      denyWith(403, 'forbidden_cannot_manage_members');
      const res = await request(makeApp())
        .patch('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE)
        .send({ role: 'admin' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden_cannot_manage_members' });
    });

    it('200 — owner promotes member to admin', async () => {
      allowAs('owner', 'owner');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'member' as const })),
      });
      const res = await request(makeApp(repo))
        .patch('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE)
        .send({ role: 'admin' });
      expect(res.status).toBe(200);
      expect(repo.updateMembershipRole).toHaveBeenCalledWith('ws-1', 'target', 'admin');
    });

    it('200 — admin demotes admin to member', async () => {
      allowAs('admin1', 'admin');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'admin' as const })),
      });
      const res = await request(makeApp(repo))
        .patch('/workspaces/ws-1/members/admin2')
        .set('Cookie', COOKIE)
        .send({ role: 'member' });
      expect(res.status).toBe(200);
      expect(repo.updateMembershipRole).toHaveBeenCalledWith('ws-1', 'admin2', 'member');
    });

    it('400 when role is not member|admin (blocks promotion to owner)', async () => {
      allowAs('owner', 'owner');
      const res = await request(makeApp())
        .patch('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE)
        .send({ role: 'owner' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'role_invalid' });
    });

    it('403 cannot change own role', async () => {
      allowAs('self', 'owner');
      const res = await request(makeApp())
        .patch('/workspaces/ws-1/members/self')
        .set('Cookie', COOKIE)
        .send({ role: 'admin' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'cannot_modify_self' });
    });

    it('403 cannot change role of an owner row', async () => {
      allowAs('admin1', 'admin');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'owner' as const })),
      });
      const res = await request(makeApp(repo))
        .patch('/workspaces/ws-1/members/the-owner')
        .set('Cookie', COOKIE)
        .send({ role: 'member' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'cannot_modify_owner' });
      expect(repo.updateMembershipRole).not.toHaveBeenCalled();
    });

    it('404 when target user is not a member of this workspace', async () => {
      allowAs('owner', 'owner');
      const repo = makeRepo({ findMembership: vi.fn(async () => null) });
      const res = await request(makeApp(repo))
        .patch('/workspaces/ws-1/members/ghost')
        .set('Cookie', COOKIE)
        .send({ role: 'admin' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'member_not_found' });
    });
  });

  describe('DELETE /workspaces/:id/members/:userId', () => {
    it('401 without session', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp()).delete('/workspaces/ws-1/members/target');
      expect(res.status).toBe(401);
    });

    it('403 when caller is a member', async () => {
      denyWith(403, 'forbidden_cannot_manage_members');
      const res = await request(makeApp())
        .delete('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
    });

    it('200 — admin kicks member', async () => {
      allowAs('admin1', 'admin');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'member' as const })),
      });
      const res = await request(makeApp(repo))
        .delete('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.deleteMembership).toHaveBeenCalledWith('ws-1', 'target');
    });

    it('200 — owner kicks admin', async () => {
      allowAs('owner', 'owner');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'admin' as const })),
      });
      const res = await request(makeApp(repo))
        .delete('/workspaces/ws-1/members/admin1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.deleteMembership).toHaveBeenCalledWith('ws-1', 'admin1');
    });

    it('403 cannot kick self', async () => {
      allowAs('self', 'admin');
      const res = await request(makeApp())
        .delete('/workspaces/ws-1/members/self')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'cannot_kick_self' });
    });

    it('403 cannot kick an owner (regardless of caller role)', async () => {
      allowAs('admin1', 'admin');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'owner' as const })),
      });
      const res = await request(makeApp(repo))
        .delete('/workspaces/ws-1/members/the-owner')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'cannot_kick_owner' });
      expect(repo.deleteMembership).not.toHaveBeenCalled();
    });

    it('404 when target user is not a member', async () => {
      allowAs('owner', 'owner');
      const repo = makeRepo({ findMembership: vi.fn(async () => null) });
      const res = await request(makeApp(repo))
        .delete('/workspaces/ws-1/members/ghost')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(404);
    });

    it('side-effect: nulls current_workspace_id when it matched the kicked workspace', async () => {
      allowAs('owner', 'owner');
      const repo = makeRepo({
        findMembership: vi.fn(async () => ({ role: 'member' as const })),
      });
      await request(makeApp(repo))
        .delete('/workspaces/ws-1/members/target')
        .set('Cookie', COOKIE)
        .expect(200);
      expect(repo.clearCurrentWorkspaceIfMatches).toHaveBeenCalledWith('target', 'ws-1');
    });
  });
});
