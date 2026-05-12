import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWorkspaceProvisionRouter,
  deriveRuntime,
  sanitizeProvisioningLastError,
} from './provision.js';

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
  provisionTenant: vi.fn(),
  safelyProvisionTenant: vi.fn(),
  sendEmail: vi.fn(),
  generateInviteLink: vi.fn(),
}));

// requireRole pulls in requireMembership which validates the session cookie
// AND asserts a real membership row. Both go through the DB. Mock both at
// the module level — the retry-provision tests below drive auth state via
// `retryAuthMock.impl` (same pattern as members.test.ts).
const retryAuthMock = vi.hoisted(() => ({
  impl: (req: Request, _res: Response, next: NextFunction) => {
    const wsId = (req.body as { workspace_id?: string } | undefined)?.workspace_id ?? 'ws-1';
    req.workspace = { id: wsId, role: 'owner' };
    req.session = { id: 'sess-1', userId: 'user-1' };
    next();
  },
}));

vi.mock('../../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));

vi.mock('../../tenants/provision.js', () => ({
  provisionTenant: mocks.provisionTenant,
  safelyProvisionTenant: mocks.safelyProvisionTenant,
}));

vi.mock('../../middleware/require-role.js', () => ({
  requireRole: () => [
    (req: Request, res: Response, next: NextFunction) => retryAuthMock.impl(req, res, next),
  ],
}));

describe('workspace provision route', () => {
  beforeEach(() => {
    mocks.validateSession.mockReset();
    mocks.provisionTenant.mockReset();
    mocks.safelyProvisionTenant.mockReset();
    mocks.sendEmail.mockReset();
    mocks.generateInviteLink.mockReset();
  });

  it('returns 401 without a valid Open42 session', async () => {
    mocks.validateSession.mockResolvedValue(null);
    const app = makeApp();

    const res = await request(app)
      .post('/workspaces/onboarding/workspace')
      .set('Cookie', 'open42_session=session-missing')
      .send({ name: 'Speedrun Labs' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(mocks.safelyProvisionTenant).not.toHaveBeenCalled();
  });

  it('captures workspace name and invites during onboarding', async () => {
    mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
    mocks.generateInviteLink.mockResolvedValue({
      actionLink: 'https://supabase.example/verify?token=abc',
      expiresAt: new Date(),
    });
    mocks.sendEmail.mockResolvedValue({ ok: true });
    const repo = makeRepo();
    const app = makeApp(repo);

    await request(app)
      .post('/workspaces/onboarding/workspace')
      .set('Cookie', 'open42_session=session-1')
      .send({ name: 'Speedrun Labs' })
      .expect(200);
    await request(app)
      .post('/workspaces/onboarding/invites')
      .set('Cookie', 'open42_session=session-1')
      .send({ emails: ['founder@example.com', 'Founder@example.com '] })
      .expect(200);

    expect(repo.saveWorkspaceName).toHaveBeenCalledWith('user-1', 'Speedrun Labs');
    expect(repo.upsertInvites).toHaveBeenCalledWith('user-1', ['founder@example.com']);
  });

  it('returns 404 for the deleted POST /workspaces/onboarding/plan endpoint', async () => {
    mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
    const app = makeApp();

    const res = await request(app)
      .post('/workspaces/onboarding/plan')
      .set('Cookie', 'open42_session=session-1')
      .send({ plan: 'team' });

    expect(res.status).toBe(404);
  });

  it('returns 404 for the deleted POST /workspaces/provision endpoint', async () => {
    mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
    const app = makeApp();

    const res = await request(app)
      .post('/workspaces/provision')
      .set('Cookie', 'open42_session=session-1')
      .send({});

    expect(res.status).toBe(404);
    expect(mocks.safelyProvisionTenant).not.toHaveBeenCalled();
  });

  describe('POST /workspaces/onboarding/workspace (idempotent)', () => {
    it('creates workspace + kicks off provisioning on first call', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      mocks.safelyProvisionTenant.mockResolvedValue({
        workspaceId: 'workspace-1',
        tenantRuntimeId: 'machine-1',
        gbrainPrivateAddress: '127.0.0.1:18080',
        gbrainBaseUrl: 'http://127.0.0.1:18080',
      });
      const repo = makeRepo({
        workspace: {
          id: 'workspace-1',
          name: 'Speedrun Labs',
          plan: null,
          status: 'provisioning',
          gbrainReady: false,
          runtime: 'provisioning',
          lastError: null,
          provisionAttempts: 0,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });
      repo.saveWorkspaceName.mockResolvedValueOnce({
        payload: {
          user: { id: 'user-1', email: 'user@example.com' },
          workspace: {
            id: 'workspace-1',
            name: 'Speedrun Labs',
            plan: null,
            status: 'provisioning',
            gbrainReady: false,
            runtime: 'provisioning',
            lastError: null,
            provisionAttempts: 0,
            provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
            createdAt: new Date('2026-05-07T10:00:00Z'),
          },
          invites: [],
          connections: [],
          lastJob: null,
          requiresProviderKeys: true,
          providerKeys: { anthropicChat: false, openaiEmbed: false },
        },
        wasCreated: true,
      });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/workspace')
        .set('Cookie', 'open42_session=session-1')
        .send({ name: 'Speedrun Labs' });

      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(mocks.safelyProvisionTenant).toHaveBeenCalledTimes(1);
      expect(mocks.safelyProvisionTenant).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      });
    });

    it('returns existing workspace and does NOT re-provision when name matches', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo();
      // saveWorkspaceName default returns wasCreated: false
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/workspace')
        .set('Cookie', 'open42_session=session-1')
        .send({ name: 'Speedrun Labs' });

      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(mocks.safelyProvisionTenant).not.toHaveBeenCalled();
    });

    it('renames existing workspace and does NOT re-provision when name differs', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo();
      repo.saveWorkspaceName.mockResolvedValueOnce({
        payload: {
          user: { id: 'user-1', email: 'user@example.com' },
          workspace: {
            id: 'workspace-1',
            name: 'New Name',
            plan: 'team',
            status: 'provisioning',
            gbrainReady: false,
            runtime: 'provisioning',
            lastError: null,
            provisionAttempts: 0,
            provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
            createdAt: new Date('2026-05-07T10:00:00Z'),
          },
          invites: [],
          connections: [],
          lastJob: null,
          requiresProviderKeys: true,
          providerKeys: { anthropicChat: false, openaiEmbed: false },
        },
        wasCreated: false,
      });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/workspace')
        .set('Cookie', 'open42_session=session-1')
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.workspace.name).toBe('New Name');
      await new Promise((r) => setImmediate(r));
      expect(mocks.safelyProvisionTenant).not.toHaveBeenCalled();
      expect(repo.saveWorkspaceName).toHaveBeenCalledWith('user-1', 'New Name');
    });
  });

  describe('POST /workspaces/onboarding/invites', () => {
    it('upserts invite rows and sends Resend email per address', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      mocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      mocks.sendEmail.mockResolvedValue({ ok: true });
      const repo = makeRepo();
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/invites')
        .set('Cookie', 'open42_session=session-1')
        .send({ emails: ['a@example.com', 'b@example.com'] });

      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(2);
      expect(res.body.failed).toBe(0);
      expect(repo.upsertInvites).toHaveBeenCalledWith('user-1', ['a@example.com', 'b@example.com']);
      expect(mocks.generateInviteLink).toHaveBeenCalledTimes(2);
      expect(mocks.generateInviteLink).toHaveBeenCalledWith({
        email: 'a@example.com',
        redirectTo: expect.stringContaining('/invite/accept?invite_id=invite-0'),
      });
      expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@example.com',
          subject: expect.stringContaining('invited you to'),
        }),
      );
    });

    it('upserts on conflict: re-inviting same email does not duplicate row', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      mocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      mocks.sendEmail.mockResolvedValue({ ok: true });
      // Repo simulates the partial-unique-index upsert: same email always
      // returns the same invite row id (id-stable across both calls).
      const repo = makeRepo();
      repo.upsertInvites.mockImplementation(async (_userId: string, emails: string[]) => ({
        workspaceId: 'workspace-1',
        workspaceName: 'Speedrun Labs',
        inviterEmail: 'user@example.com',
        invites: emails.map((email) => ({ id: `stable-${email}`, email })),
      }));
      const app = makeApp(repo);

      await request(app)
        .post('/workspaces/onboarding/invites')
        .set('Cookie', 'open42_session=session-1')
        .send({ emails: ['dup@example.com'] })
        .expect(200);
      await request(app)
        .post('/workspaces/onboarding/invites')
        .set('Cookie', 'open42_session=session-1')
        .send({ emails: ['dup@example.com'] })
        .expect(200);

      expect(repo.upsertInvites).toHaveBeenCalledTimes(2);
      // Both calls returned the same invite id — proves conflict-update path,
      // not a duplicate row.
      const firstCall = await repo.upsertInvites.mock.results[0]!.value;
      const secondCall = await repo.upsertInvites.mock.results[1]!.value;
      expect(firstCall.invites[0].id).toBe(secondCall.invites[0].id);
    });

    it('returns failed count when Resend fails', async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      mocks.generateInviteLink.mockResolvedValue({
        actionLink: 'https://supabase.example/verify?token=abc',
        expiresAt: new Date(),
      });
      mocks.sendEmail
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, error: 'rate_limited' });
      const app = makeApp(makeRepo());

      const res = await request(app)
        .post('/workspaces/onboarding/invites')
        .set('Cookie', 'open42_session=session-1')
        .send({ emails: ['ok@example.com', 'bad@example.com'] });

      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(1);
      expect(res.body.failed).toBe(1);
    });
  });

  describe('POST /workspaces/onboarding/retry-provision (codex round-4 P2)', () => {
    beforeEach(() => {
      // Default: owner of ws-1.
      retryAuthMock.impl = (req, _res, next) => {
        const wsId = (req.body as { workspace_id?: string } | undefined)?.workspace_id ?? 'ws-1';
        req.workspace = { id: wsId, role: 'owner' };
        req.session = { id: 'sess-1', userId: 'user-1' };
        next();
      };
    });

    it('returns 400 workspace_id_required when body has no workspace_id', async () => {
      // Mirror requireMembership's 400 response (the real middleware returns
      // this; the test mock has to simulate it explicitly).
      retryAuthMock.impl = (_req, res, _next) => {
        res.status(400).json({ error: 'workspace_id_required' });
      };
      const repo = makeRepo({
        workspace: {
          id: 'workspace-1',
          name: 'Speedrun Labs',
          plan: null,
          status: 'failed',
          gbrainReady: false,
          runtime: 'failed',
          lastError: 'docker_unavailable',
          provisionAttempts: 1,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/retry-provision')
        .set('Cookie', 'open42_session=session-1')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('workspace_id_required');
      expect(repo.markWorkspaceProvisioning).not.toHaveBeenCalled();
    });

    it('returns 403 forbidden_cannot_retry when caller is not the owner', async () => {
      // The real requireRole responds 403 for non-owners; mock that response.
      retryAuthMock.impl = (_req, res, _next) => {
        res.status(403).json({ error: 'forbidden_cannot_retry' });
      };
      const repo = makeRepo({
        workspace: {
          id: 'ws-1',
          name: 'Speedrun Labs',
          plan: null,
          status: 'failed',
          gbrainReady: false,
          runtime: 'failed',
          lastError: 'docker_unavailable',
          provisionAttempts: 1,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/retry-provision')
        .set('Cookie', 'open42_session=session-1')
        .send({ workspace_id: 'ws-1' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden_cannot_retry');
      expect(repo.markWorkspaceProvisioning).not.toHaveBeenCalled();
    });

    it('returns 404 workspace_not_found when the workspace was soft-deleted mid-flight', async () => {
      const repo = makeRepo();
      repo.findRetryableWorkspace.mockResolvedValueOnce(null);
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/retry-provision')
        .set('Cookie', 'open42_session=session-1')
        .send({ workspace_id: 'ws-deleted' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('workspace_not_found');
      expect(repo.markWorkspaceProvisioning).not.toHaveBeenCalled();
    });

    it("short-circuits with 200 ok status='ready' when the targeted workspace is already ready", async () => {
      const repo = makeRepo();
      repo.findRetryableWorkspace.mockResolvedValueOnce({ id: 'ws-1', status: 'ready' });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/retry-provision')
        .set('Cookie', 'open42_session=session-1')
        .send({ workspace_id: 'ws-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: 'ready' });
      expect(repo.markWorkspaceProvisioning).not.toHaveBeenCalled();
      expect(mocks.safelyProvisionTenant).not.toHaveBeenCalled();
    });

    it('retries the specific workspace_id passed in the body (multi-workspace)', async () => {
      // Codex round-4 P2 regression guard: pre-fix the handler ignored the
      // body and used resolveOwnerWorkspaceId with LIMIT 1. Confirm the
      // worker is called with the workspace_id we sent, not some other
      // workspace the user owns.
      mocks.safelyProvisionTenant.mockResolvedValue({
        workspaceId: 'ws-target',
        tenantRuntimeId: 'machine-target',
        gbrainPrivateAddress: '127.0.0.1:18099',
        gbrainBaseUrl: 'http://127.0.0.1:18099',
      });
      const repo = makeRepo();
      repo.findRetryableWorkspace.mockResolvedValueOnce({
        id: 'ws-target',
        status: 'failed',
      });
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/retry-provision')
        .set('Cookie', 'open42_session=session-1')
        .send({ workspace_id: 'ws-target' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ ok: true, status: 'provisioning' });
      expect(repo.findRetryableWorkspace).toHaveBeenCalledWith('ws-target');
      expect(repo.markWorkspaceProvisioning).toHaveBeenCalledWith('ws-target');
      // Wait for the inline `void safelyProvisionTenant` to flush.
      await new Promise((r) => setImmediate(r));
      expect(mocks.safelyProvisionTenant).toHaveBeenCalledWith({
        workspaceId: 'ws-target',
        ownerUserId: 'user-1',
      });
    });
  });

  // (re-open the parent describe for the original empty-array test below)
  describe('POST /workspaces/onboarding/invites (continued)', () => {
    it('returns 200 + sent=0 (not 500) when emails is an empty array', async () => {
      // Codex round-3 P2: pre-refactor, the onboarding UX could POST
      // `{ emails: [] }` to skip the invite step. After moving the send
      // loop into sendInvitesForWorkspace, an empty array slipped past
      // normalizeInviteEmails into the helper, which threw
      // `invite_emails_required` and the global error handler mapped it
      // to 500. The route now short-circuits to a 200 no-op.
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo();
      const app = makeApp(repo);

      const res = await request(app)
        .post('/workspaces/onboarding/invites')
        .set('Cookie', 'open42_session=session-1')
        .send({ emails: [] });

      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(0);
      expect(res.body.failed).toBe(0);
      // No upsert / send activity should have fired for an empty batch.
      expect(repo.upsertInvites).not.toHaveBeenCalled();
      expect(mocks.generateInviteLink).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('GET /workspaces/current runtime field', () => {
    it("exposes runtime: 'provisioning' from the repo when status is 'provisioning'", async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo({
        workspace: {
          id: 'workspace-1',
          name: 'Speedrun Labs',
          plan: null,
          status: 'provisioning',
          gbrainReady: false,
          runtime: 'provisioning',
          lastError: null,
          provisionAttempts: 0,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });

      const res = await request(makeApp(repo))
        .get('/workspaces/current')
        .set('Cookie', 'open42_session=session-1');

      expect(res.status).toBe(200);
      expect(res.body.workspace.runtime).toBe('provisioning');
    });

    it("exposes runtime: 'ready' when status='ready' and gbrain is configured", async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo({
        workspace: {
          id: 'workspace-1',
          name: 'Speedrun Labs',
          plan: 'team',
          status: 'ready',
          gbrainReady: true,
          runtime: 'ready',
          lastError: null,
          provisionAttempts: 0,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });

      const res = await request(makeApp(repo))
        .get('/workspaces/current')
        .set('Cookie', 'open42_session=session-1');

      expect(res.body.workspace.runtime).toBe('ready');
    });

    it("exposes runtime: 'failed' when workspace status is 'failed'", async () => {
      mocks.validateSession.mockResolvedValue({ userId: 'user-1' });
      const repo = makeRepo({
        workspace: {
          id: 'workspace-1',
          name: 'Speedrun Labs',
          plan: null,
          status: 'failed',
          gbrainReady: false,
          runtime: 'failed',
          lastError: 'docker_unavailable: cannot connect to docker daemon',
          provisionAttempts: 1,
          provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
          createdAt: new Date('2026-05-07T10:00:00Z'),
        },
      });

      const res = await request(makeApp(repo))
        .get('/workspaces/current')
        .set('Cookie', 'open42_session=session-1');

      expect(res.body.workspace.runtime).toBe('failed');
      expect(res.body.workspace.lastError).toBe('docker_unavailable');
    });
  });
});

describe('deriveRuntime', () => {
  const fresh = new Date('2026-05-08T20:00:00Z');
  const overdue = new Date('2026-05-08T19:58:00Z'); // 2 minutes before "now"
  const now = new Date('2026-05-08T20:00:00Z');

  it("returns 'provisioning' when fresh", () => {
    expect(
      deriveRuntime({
        status: 'provisioning',
        gbrainReady: false,
        provisioningStartedAt: fresh,
        now,
      }),
    ).toBe('provisioning');
  });

  it("returns 'overdue' once provisioning has run past the threshold", () => {
    expect(
      deriveRuntime({
        status: 'provisioning',
        gbrainReady: false,
        provisioningStartedAt: overdue,
        now,
      }),
    ).toBe('overdue');
  });

  it("returns 'ready' when status='ready' AND gbrainReady=true", () => {
    expect(
      deriveRuntime({
        status: 'ready',
        gbrainReady: true,
        provisioningStartedAt: fresh,
        now,
      }),
    ).toBe('ready');
  });

  it("returns 'failed' when status='failed' regardless of other inputs", () => {
    expect(
      deriveRuntime({
        status: 'failed',
        gbrainReady: false,
        provisioningStartedAt: fresh,
        now,
      }),
    ).toBe('failed');
    expect(
      deriveRuntime({
        status: 'failed',
        gbrainReady: true,
        provisioningStartedAt: fresh,
        now,
      }),
    ).toBe('failed');
  });

  it("falls back to 'provisioning' when status='ready' but gbrain not configured", () => {
    expect(
      deriveRuntime({
        status: 'ready',
        gbrainReady: false,
        provisioningStartedAt: fresh,
        now,
      }),
    ).toBe('provisioning');
  });
});

describe('sanitizeProvisioningLastError', () => {
  it('returns only stable provisioning error codes', () => {
    expect(sanitizeProvisioningLastError('docker_unavailable: cannot connect to docker')).toBe(
      'docker_unavailable',
    );
    expect(sanitizeProvisioningLastError('postgres://user:secret@example/db')).toBe(
      'provisioning_failed',
    );
    expect(sanitizeProvisioningLastError(null)).toBeNull();
  });
});

function makeApp(repo = makeRepo()) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    '/workspaces',
    buildWorkspaceProvisionRouter({
      provisionTenant: mocks.provisionTenant,
      safelyProvisionTenant: mocks.safelyProvisionTenant,
      repo,
      sendEmail: mocks.sendEmail,
      generateInviteLink: mocks.generateInviteLink,
    }),
  );
  return app;
}

type WorkspacePlan = 'starter' | 'team' | 'business';
type WorkspaceRuntime = 'provisioning' | 'overdue' | 'ready' | 'failed';

interface MockWorkspace {
  id: string;
  name: string;
  plan: WorkspacePlan | null;
  status: string;
  gbrainReady: boolean;
  runtime: WorkspaceRuntime;
  lastError: string | null;
  provisionAttempts: number;
  provisioningStartedAt: Date;
  createdAt: Date;
}

interface MockCurrent {
  user: { id: string; email: string };
  workspace: MockWorkspace | null;
  invites: Array<{ id: string; email: string; status: string; createdAt: Date }>;
  connections: Array<{ id: string; kind: string; status: string; displayName: string }>;
  lastJob: { id: string; status: string; pagesTotal: number; createdAt: Date } | null;
  requiresProviderKeys: boolean;
  providerKeys: {
    anthropicChat: boolean;
    openaiEmbed: boolean;
  };
}

function makeRepo(currentOverride: Partial<MockCurrent> = {}) {
  const current: MockCurrent = {
    user: { id: 'user-1', email: 'user@example.com' },
    workspace: {
      id: 'workspace-1',
      name: 'Speedrun Labs',
      plan: 'team',
      status: 'provisioning',
      gbrainReady: false,
      runtime: 'provisioning',
      lastError: null,
      provisionAttempts: 0,
      provisioningStartedAt: new Date('2026-05-07T10:00:00Z'),
      createdAt: new Date('2026-05-07T10:00:00Z'),
    },
    invites: [],
    connections: [],
    lastJob: null,
    requiresProviderKeys: true,
    providerKeys: { anthropicChat: false, openaiEmbed: false },
    ...currentOverride,
  };
  return {
    current: vi.fn(async () => current),
    saveWorkspaceName: vi.fn(async () => ({ payload: current, wasCreated: false })),
    upsertInvites: vi.fn(async (_userId: string, emails: string[]) => ({
      workspaceId: current.workspace?.id ?? 'workspace-1',
      workspaceName: current.workspace?.name ?? 'Speedrun Labs',
      inviterEmail: current.user.email,
      invites: emails.map((email, idx) => ({ id: `invite-${idx}`, email })),
    })),
    findRetryableWorkspace: vi.fn(async (workspaceId: string) =>
      current.workspace && current.workspace.id === workspaceId
        ? { id: current.workspace.id, status: current.workspace.status }
        : null,
    ),
    markWorkspaceProvisioning: vi.fn(async () => {}),
  };
}
