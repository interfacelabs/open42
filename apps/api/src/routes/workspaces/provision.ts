import { and, desc, eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { provisionTenant as defaultProvisionTenant } from '../../tenants/provision.js';

const WORKSPACE_NAME_MAX = 80;
const INVITE_LIMIT = 10;
const PLANS = new Set(['starter', 'team', 'business']);

type WorkspacePlan = 'starter' | 'team' | 'business';

interface CurrentWorkspace {
  id: string;
  name: string;
  plan: WorkspacePlan | null;
  status: string;
  gbrainReady: boolean;
  createdAt: Date;
}

interface CurrentPayload {
  user: { id: string; email: string };
  workspace: CurrentWorkspace | null;
  invites: Array<{ id: string; email: string; status: string; createdAt: Date }>;
  connections: Array<{ id: string; kind: string; status: string; displayName: string }>;
  lastJob: { id: string; status: string; pagesTotal: number; createdAt: Date } | null;
}

interface WorkspaceLifecycleRepo {
  current(userId: string): Promise<CurrentPayload | null>;
  saveWorkspaceName(userId: string, name: string): Promise<CurrentPayload>;
  saveInvites(userId: string, emails: string[]): Promise<CurrentPayload>;
  savePlan(userId: string, plan: WorkspacePlan): Promise<CurrentPayload>;
}

export function buildWorkspaceProvisionRouter(deps: {
  provisionTenant?: typeof defaultProvisionTenant;
  repo?: WorkspaceLifecycleRepo;
} = {}) {
  const router = Router();
  const provisionTenant = deps.provisionTenant ?? defaultProvisionTenant;
  const repo = deps.repo ?? createDrizzleWorkspaceLifecycleRepo();

  router.get('/current', async (req, res, next) => {
    try {
      const session = await sessionFromRequest(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const current = await repo.current(session.userId);
      if (!current) {
        res.status(404).json({ error: 'user_not_found' });
        return;
      }
      res.json(current);
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/workspace', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;
      const name = normalizeWorkspaceName(req.body?.name);
      if (!name) {
        res.status(400).json({ error: 'workspace_name_invalid' });
        return;
      }
      res.json(await repo.saveWorkspaceName(session.userId, name));
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/invites', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;
      const emails = normalizeInviteEmails(req.body?.emails);
      if (!emails) {
        res.status(400).json({ error: 'invite_emails_invalid' });
        return;
      }
      res.json(await repo.saveInvites(session.userId, emails));
    } catch (err) {
      next(err);
    }
  });

  router.post('/onboarding/plan', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;
      const plan = normalizePlan(req.body?.plan);
      if (!plan) {
        res.status(400).json({ error: 'workspace_plan_invalid' });
        return;
      }
      res.json(await repo.savePlan(session.userId, plan));
    } catch (err) {
      next(err);
    }
  });

  router.post('/provision', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const current = await repo.current(session.userId);
      if (!current?.workspace) {
        res.status(409).json({ error: 'workspace_required' });
        return;
      }
      if (!current.workspace.plan) {
        res.status(409).json({ error: 'plan_required' });
        return;
      }
      if (current.workspace.gbrainReady) {
        res.json({ ok: true, workspace: current.workspace });
        return;
      }

      try {
        const workspace = await provisionTenant({ ownerUserId: session.userId });
        res.json({ ok: true, workspace });
      } catch (err) {
        console.error('tenant provisioning failed', err);
        res.status(503).json({ error: 'workspace_provision_failed' });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function requireSession(req: Request, res: { status: (status: number) => { json: (body: unknown) => void } }) {
  const session = await sessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return session;
}

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > WORKSPACE_NAME_MAX) return null;
  return name;
}

function normalizeInviteEmails(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const emails = Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  );
  if (emails.length > INVITE_LIMIT) return null;
  if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return emails;
}

function normalizePlan(value: unknown): WorkspacePlan | null {
  return typeof value === 'string' && PLANS.has(value) ? (value as WorkspacePlan) : null;
}

function createDrizzleWorkspaceLifecycleRepo(): WorkspaceLifecycleRepo {
  return {
    async current(userId) {
      return currentPayload(userId);
    },
    async saveWorkspaceName(userId, name) {
      await db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        if (!user) throw new Error('user_not_found');

        if (user.currentWorkspaceId) {
          await tx
            .update(schema.workspaces)
            .set({ name })
            .where(
              and(
                eq(schema.workspaces.id, user.currentWorkspaceId),
                eq(schema.workspaces.ownerUserId, userId),
              ),
            );
          return;
        }

        const [workspace] = await tx
          .insert(schema.workspaces)
          .values({
            ownerUserId: userId,
            name,
            gbrainVersion: process.env.GBRAIN_VERSION ?? '0.27.1',
            status: 'provisioning',
          })
          .returning({ id: schema.workspaces.id });
        if (!workspace) throw new Error('workspace_insert_failed');

        await tx
          .update(schema.users)
          .set({ currentWorkspaceId: workspace.id })
          .where(eq(schema.users.id, userId));
        await tx
          .insert(schema.memberships)
          .values({ userId, workspaceId: workspace.id, role: 'owner' })
          .onConflictDoNothing();
      });
      const current = await currentPayload(userId);
      if (!current) throw new Error('user_not_found');
      return current;
    },
    async saveInvites(userId, emails) {
      const current = await currentPayload(userId);
      if (!current?.workspace) throw new Error('workspace_required');
      if (emails.length > 0) {
        await db
          .insert(schema.workspaceInvites)
          .values(
            emails.map((email) => ({
              workspaceId: current.workspace!.id,
              invitedByUserId: userId,
              email,
              role: 'member' as const,
              status: 'pending' as const,
            })),
          )
          .onConflictDoNothing();
      }
      const next = await currentPayload(userId);
      if (!next) throw new Error('user_not_found');
      return next;
    },
    async savePlan(userId, plan) {
      const current = await currentPayload(userId);
      if (!current?.workspace) throw new Error('workspace_required');
      await db
        .update(schema.workspaces)
        .set({ plan })
        .where(and(eq(schema.workspaces.id, current.workspace.id), eq(schema.workspaces.ownerUserId, userId)));
      const next = await currentPayload(userId);
      if (!next) throw new Error('user_not_found');
      return next;
    },
  };
}

async function currentPayload(userId: string): Promise<CurrentPayload | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) return null;

  const workspace = user.currentWorkspaceId
    ? await currentWorkspace(user.currentWorkspaceId)
    : null;
  const invites = workspace
    ? await db
        .select({
          id: schema.workspaceInvites.id,
          email: schema.workspaceInvites.email,
          status: schema.workspaceInvites.status,
          createdAt: schema.workspaceInvites.createdAt,
        })
        .from(schema.workspaceInvites)
        .where(eq(schema.workspaceInvites.workspaceId, workspace.id))
        .orderBy(desc(schema.workspaceInvites.createdAt))
    : [];
  const connections = workspace
    ? await db
        .select({
          id: schema.connections.id,
          kind: schema.connections.kind,
          status: schema.connections.status,
          displayName: schema.connections.displayName,
        })
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.workspaceId, workspace.id),
            sql`${schema.connections.deletedAt} IS NULL`,
          ),
        )
    : [];
  const [lastJob] = workspace
    ? await db
        .select({
          id: schema.ingestJobs.id,
          status: schema.ingestJobs.status,
          pagesTotal: schema.ingestJobs.pagesTotal,
          createdAt: schema.ingestJobs.createdAt,
        })
        .from(schema.ingestJobs)
        .where(eq(schema.ingestJobs.workspaceId, workspace.id))
        .orderBy(desc(schema.ingestJobs.createdAt))
        .limit(1)
    : [];

  return {
    user: { id: user.id, email: user.email },
    workspace,
    invites,
    connections,
    lastJob: lastJob ?? null,
  };
}

async function currentWorkspace(workspaceId: string): Promise<CurrentWorkspace | null> {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return null;
  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    status: workspace.status,
    gbrainReady: Boolean(
      (workspace.gbrainBaseUrl || workspace.flyPrivateIp) &&
        workspace.gbrainOauthClientId &&
        workspace.gbrainOauthClientSecretCiphertext,
    ),
    createdAt: workspace.createdAt,
  };
}
