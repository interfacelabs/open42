import { and, desc, eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { generateInviteLink as defaultGenerateInviteLink } from '../../auth/supabase.js';
import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { renderInviteEmail } from '../../integrations/email-templates/invite.js';
import { sendEmail as defaultSendEmail } from '../../integrations/resend.js';
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

export interface InviteRow {
  id: string;
  email: string;
}

export interface UpsertInvitesResult {
  workspaceId: string;
  workspaceName: string;
  inviterEmail: string;
  invites: InviteRow[];
}

interface WorkspaceLifecycleRepo {
  current(userId: string): Promise<CurrentPayload | null>;
  saveWorkspaceName(
    userId: string,
    name: string,
  ): Promise<{ payload: CurrentPayload; wasCreated: boolean }>;
  upsertInvites(userId: string, emails: string[]): Promise<UpsertInvitesResult>;
  savePlan(userId: string, plan: WorkspacePlan): Promise<CurrentPayload>;
}

export function buildWorkspaceProvisionRouter(deps: {
  provisionTenant?: typeof defaultProvisionTenant;
  repo?: WorkspaceLifecycleRepo;
  sendEmail?: typeof defaultSendEmail;
  generateInviteLink?: typeof defaultGenerateInviteLink;
} = {}) {
  const router = Router();
  const provisionTenant = deps.provisionTenant ?? defaultProvisionTenant;
  const repo = deps.repo ?? createDrizzleWorkspaceLifecycleRepo();
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const generateInviteLink = deps.generateInviteLink ?? defaultGenerateInviteLink;

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
      const { payload, wasCreated } = await repo.saveWorkspaceName(session.userId, name);
      if (wasCreated && payload.workspace) {
        // Fire-and-forget: provisioning is slow (~30s), client polls /current.runtime for state.
        void provisionTenant({ ownerUserId: session.userId }).catch((err) =>
          console.error('[provision] async failure', err),
        );
      }
      res.json(payload);
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
      const { workspaceName, inviterEmail, invites } = await repo.upsertInvites(
        session.userId,
        emails,
      );

      const webUrl = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
      let sent = 0;
      let failed = 0;
      for (const invite of invites) {
        try {
          const { actionLink } = await generateInviteLink({
            email: invite.email,
            redirectTo: `${webUrl}/auth/invite/accept?invite_id=${invite.id}`,
          });
          const rendered = renderInviteEmail({
            workspaceName,
            inviterEmail,
            inviteUrl: actionLink,
          });
          const result = await sendEmail({
            to: invite.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          if (result.ok) {
            sent += 1;
          } else {
            failed += 1;
            console.error('[invite-email] resend failed', invite.email, result.error);
          }
        } catch (err) {
          failed += 1;
          console.error('[invite-email] generate-link failed', invite.email, err);
        }
      }

      const payload = await repo.current(session.userId);
      res.json({ ...payload, sent, failed });
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
      const wasCreated = await db.transaction(async (tx) => {
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
          return false;
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
        return true;
      });
      const current = await currentPayload(userId);
      if (!current) throw new Error('user_not_found');
      return { payload: current, wasCreated };
    },
    async upsertInvites(userId, emails) {
      const current = await currentPayload(userId);
      if (!current?.workspace) throw new Error('workspace_required');
      const workspaceId = current.workspace.id;
      const inviterEmail = current.user.email;
      const workspaceName = current.workspace.name;

      if (emails.length === 0) {
        return { workspaceId, workspaceName, inviterEmail, invites: [] };
      }

      // D5: re-inviting an email refreshes createdAt and rebinds invitedByUserId.
      // Partial unique index on (workspaceId, email) where status='pending' targets the conflict.
      const inserted = await db
        .insert(schema.workspaceInvites)
        .values(
          emails.map((email) => ({
            workspaceId,
            invitedByUserId: userId,
            email,
            role: 'member' as const,
            status: 'pending' as const,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.workspaceInvites.workspaceId, schema.workspaceInvites.email],
          targetWhere: sql`${schema.workspaceInvites.status} = 'pending'`,
          set: {
            invitedByUserId: userId,
            createdAt: sql`NOW()`,
          },
        })
        .returning({
          id: schema.workspaceInvites.id,
          email: schema.workspaceInvites.email,
        });

      return { workspaceId, workspaceName, inviterEmail, invites: inserted };
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
