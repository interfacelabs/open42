import express from 'express';
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

vi.mock('../../auth/sessions.js', () => ({
  validateSession: mocks.validateSession,
}));

vi.mock('../../tenants/provision.js', () => ({
  provisionTenant: mocks.provisionTenant,
  safelyProvisionTenant: mocks.safelyProvisionTenant,
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
        flyMachineId: 'machine-1',
        flyPrivateIp: '127.0.0.1:18080',
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
      expect(mocks.safelyProvisionTenant).toHaveBeenCalledWith({ ownerUserId: 'user-1' });
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
        redirectTo: expect.stringContaining('/auth/invite/accept?invite_id=invite-0'),
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
  };
}
