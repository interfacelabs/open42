import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks. The router under test goes through `requireRole` (which
// itself layers on top of `requireMembership`); we mock both so each test
// can drive auth state via `middlewareMocks.impl`. Default is "session
// present, owner role" — individual tests override to simulate 401/403.
const middlewareMocks = vi.hoisted(() => ({
  impl: (req: Request, _res: Response, next: NextFunction) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role: 'owner' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  },
  generateInviteLink: vi.fn(),
  sendEmail: vi.fn(),
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

vi.mock('../../auth/supabase.js', () => ({
  generateInviteLink: middlewareMocks.generateInviteLink,
}));

vi.mock('../../integrations/resend.js', () => ({
  sendEmail: middlewareMocks.sendEmail,
}));

import { buildInvitesRouter, type InvitesRouterRepo } from './invites.js';
import { ResendRateLimiter } from '../../invites/resend-rate-limit.js';

/** Convenience: set the middleware to deny with the given 401/403 code. */
function denyWith(status: 401 | 403, code: string) {
  middlewareMocks.impl = (_req, res, _next) => {
    res.status(status).json({ error: code });
  };
}

/** Convenience: set the middleware to allow with a specific session userId. */
function allowAs(userId: string, role: 'owner' | 'admin' | 'member' = 'owner') {
  middlewareMocks.impl = (req, _res, next) => {
    req.workspace = { id: req.params.id ?? 'ws-1', role };
    req.session = { id: 'sess', userId };
    next();
  };
}

function makeRepo(overrides: Partial<InvitesRouterRepo> = {}): InvitesRouterRepo {
  return {
    fetchWorkspaceName: vi.fn(async () => 'Speedrun Labs'),
    fetchUserEmail: vi.fn(async () => 'owner@example.com'),
    upsertInvitesForWorkspace: vi.fn(async ({ emails }: { emails: string[] }) => ({
      invites: emails.map((email: string, idx: number) => ({
        id: `inv-${idx}`,
        email,
        role: 'member' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      })),
      failed: [],
    })),
    listInvites: vi.fn(async () => []),
    findInvite: vi.fn(async () => null),
    touchInviteCreatedAt: vi.fn(async () => {}),
    revokeInvite: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeApp(opts: { repo?: InvitesRouterRepo; rateLimiter?: ResendRateLimiter } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/workspaces',
    buildInvitesRouter({
      repo: opts.repo ?? makeRepo(),
      rateLimiter: opts.rateLimiter ?? new ResendRateLimiter({ windowMs: 60_000 }),
    }),
  );
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
  middlewareMocks.generateInviteLink.mockReset();
  middlewareMocks.sendEmail.mockReset();
});

describe('per-workspace invite routes', () => {
  describe('POST /workspaces/:id/invites', () => {
    it('401 when no session cookie', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites')
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(401);
    });

    it('403 when caller is a member (cannot invite)', async () => {
      denyWith(403, 'forbidden_cannot_invite');
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden_cannot_invite' });
    });

    it('happy path: calls sendInvitesForWorkspace with body emails + role; returns sent count', async () => {
      middlewareMocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      middlewareMocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo();
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['a@example.com', 'b@example.com'], role: 'admin' });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(2);
      expect(res.body.failed).toEqual([]);
      expect(repo.upsertInvitesForWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          emails: ['a@example.com', 'b@example.com'],
          role: 'admin',
        }),
      );
    });

    it('400 when emails array is empty', async () => {
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: [] });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invite_emails_invalid' });
    });

    it('400 when emails array is >10', async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: tooMany });
      expect(res.status).toBe(400);
    });

    it('400 when an email fails the regex', async () => {
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['not-an-email'] });
      expect(res.status).toBe(400);
    });

    it('skips self-invite per-email (rest of batch proceeds) — failed[] includes cannot_invite_self', async () => {
      middlewareMocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      middlewareMocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo({
        upsertInvitesForWorkspace: vi.fn(async ({ emails }: { emails: string[] }) => ({
          invites: emails
            .filter((e: string) => e !== 'owner@example.com')
            .map((email: string, idx: number) => ({
              id: `inv-${idx}`,
              email,
              role: 'member' as const,
              status: 'pending' as const,
              createdAt: new Date(),
            })),
          failed: [{ email: 'owner@example.com', reason: 'cannot_invite_self' }],
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['a@example.com', 'owner@example.com'] });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(1);
      expect(res.body.failed).toEqual([
        { email: 'owner@example.com', reason: 'cannot_invite_self' },
      ]);
    });

    it('skips already-member emails per-email — failed[] includes already_member', async () => {
      middlewareMocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      middlewareMocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo({
        upsertInvitesForWorkspace: vi.fn(async () => ({
          invites: [
            {
              id: 'inv-1',
              email: 'a@example.com',
              role: 'member' as const,
              status: 'pending' as const,
              createdAt: new Date(),
            },
          ],
          failed: [{ email: 'member@example.com', reason: 'already_member' }],
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['a@example.com', 'member@example.com'] });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(1);
      expect(res.body.failed).toEqual([
        { email: 'member@example.com', reason: 'already_member' },
      ]);
    });

    it('404 when workspace does not exist', async () => {
      const repo = makeRepo({ fetchWorkspaceName: vi.fn(async () => null) });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE)
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /workspaces/:id/invites', () => {
    it('401 without session', async () => {
      denyWith(401, 'unauthorized');
      const res = await request(makeApp()).get('/workspaces/ws-1/invites');
      expect(res.status).toBe(401);
    });

    it('403 when caller is a member (cannot invite)', async () => {
      denyWith(403, 'forbidden_cannot_invite');
      const res = await request(makeApp())
        .get('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
    });

    it('returns pending invites by default', async () => {
      const repo = makeRepo({
        listInvites: vi.fn(async () => [
          {
            id: 'inv-1',
            workspaceId: 'ws-1',
            email: 'a@example.com',
            role: 'member' as const,
            status: 'pending' as const,
            createdAt: new Date(),
            invitedByUserId: 'u',
          },
        ]),
      });
      const res = await request(makeApp({ repo }))
        .get('/workspaces/ws-1/invites')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(res.body.invites).toHaveLength(1);
      expect(repo.listInvites).toHaveBeenCalledWith({ workspaceId: 'ws-1', status: 'pending' });
    });

    it('returns all statuses when ?status=all', async () => {
      const repo = makeRepo();
      await request(makeApp({ repo }))
        .get('/workspaces/ws-1/invites?status=all')
        .set('Cookie', COOKIE)
        .expect(200);
      expect(repo.listInvites).toHaveBeenCalledWith({ workspaceId: 'ws-1', status: 'all' });
    });
  });

  describe('POST /workspaces/:id/invites/:inviteId/resend', () => {
    it('403 when caller is a member', async () => {
      denyWith(403, 'forbidden_cannot_invite');
      const res = await request(makeApp())
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(res.status).toBe(403);
    });

    it('404 when invite does not exist', async () => {
      const repo = makeRepo({ findInvite: vi.fn(async () => null) });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(res.status).toBe(404);
    });

    it('404 when invite belongs to a different workspace', async () => {
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'OTHER-WS',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'pending' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(res.status).toBe(404);
    });

    it('409 when invite status is not pending', async () => {
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'accepted' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'invite_already_accepted' });
    });

    it('429 within rate limit window; sets retry_after_ms and Retry-After header', async () => {
      middlewareMocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      middlewareMocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'pending' as const,
          createdAt: new Date(),
        })),
      });
      const rateLimiter = new ResendRateLimiter({ windowMs: 60_000 });
      const app = makeApp({ repo, rateLimiter });

      // first call succeeds
      const ok = await request(app)
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(ok.status).toBe(200);

      // second call is throttled
      const throttled = await request(app)
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(throttled.status).toBe(429);
      expect(throttled.body.error).toBe('rate_limited');
      expect(throttled.body.retry_after_ms).toBeGreaterThan(0);
      expect(throttled.headers['retry-after']).toBeDefined();
    });

    it('200 happy path — re-generates link, re-sends email, bumps created_at', async () => {
      middlewareMocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=fresh',
        expiresAt: new Date(),
      });
      middlewareMocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'pending' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .post('/workspaces/ws-1/invites/inv-1/resend')
        .set('Cookie', COOKIE)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(middlewareMocks.generateInviteLink).toHaveBeenCalledTimes(1);
      expect(middlewareMocks.sendEmail).toHaveBeenCalledTimes(1);
      expect(repo.touchInviteCreatedAt).toHaveBeenCalledWith('inv-1');
    });
  });

  describe('DELETE /workspaces/:id/invites/:inviteId', () => {
    it('403 when caller is a member', async () => {
      denyWith(403, 'forbidden_cannot_invite');
      const res = await request(makeApp())
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(403);
    });

    it('404 when invite does not exist', async () => {
      const repo = makeRepo({ findInvite: vi.fn(async () => null) });
      const res = await request(makeApp({ repo }))
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(404);
    });

    it('409 when invite is already accepted', async () => {
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'accepted' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'invite_already_accepted' });
    });

    it('200 idempotent when already revoked', async () => {
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'revoked' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.revokeInvite).not.toHaveBeenCalled();
    });

    it('200 happy path — sets status=revoked', async () => {
      allowAs('user-1', 'owner');
      const repo = makeRepo({
        findInvite: vi.fn(async () => ({
          id: 'inv-1',
          workspaceId: 'ws-1',
          email: 'a@example.com',
          role: 'member' as const,
          status: 'pending' as const,
          createdAt: new Date(),
        })),
      });
      const res = await request(makeApp({ repo }))
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(200);
      expect(repo.revokeInvite).toHaveBeenCalledWith('inv-1');
    });

    it('409 when a concurrent accept won the race (status-guarded UPDATE no-op)', async () => {
      // Codex round-7 P2: the revoke handler's first findInvite reads
      // status='pending'; meanwhile an invite-accept transaction commits
      // status='accepted'. The status-guarded UPDATE inside revokeInvite
      // no-ops; the handler re-reads and surfaces the accept by returning
      // 409 invite_already_accepted instead of a false-positive 200.
      allowAs('user-1', 'owner');
      let findCount = 0;
      const repo = makeRepo({
        findInvite: vi.fn(async () => {
          findCount += 1;
          // First read (before revoke): the invite still looks pending.
          // Second read (after revoke): a concurrent accept has flipped it.
          return {
            id: 'inv-1',
            workspaceId: 'ws-1',
            email: 'a@example.com',
            role: 'member' as const,
            status: findCount === 1 ? ('pending' as const) : ('accepted' as const),
            createdAt: new Date(),
          };
        }),
      });
      const res = await request(makeApp({ repo }))
        .delete('/workspaces/ws-1/invites/inv-1')
        .set('Cookie', COOKIE);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'invite_already_accepted' });
      // revokeInvite still ran — but at the DB level the WHERE status='pending'
      // guard would have made it a no-op against the freshly-accepted row.
      expect(repo.revokeInvite).toHaveBeenCalledWith('inv-1');
    });
  });
});
