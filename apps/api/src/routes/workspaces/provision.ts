import { and, desc, eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { resolveOwnerWorkspaceId } from '../../auth/membership.js';
import { generateInviteLink as defaultGenerateInviteLink } from '../../auth/supabase.js';
import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { renderInviteEmail } from '../../integrations/email-templates/invite.js';
import { sendEmail as defaultSendEmail } from '../../integrations/resend.js';
import {
  provisionTenant as defaultProvisionTenant,
  safelyProvisionTenant as defaultSafelyProvisionTenant,
} from '../../tenants/provision.js';

const WORKSPACE_NAME_MAX = 80;
const INVITE_LIMIT = 10;
const SAFE_PROVISIONING_ERROR_CODES = new Set([
  'docker_unavailable',
  'image_build_failed',
  'container_start_failed',
  'gbrain_health_timeout',
  'oauth_registration_failed',
  'gbrain_version_mismatch',
  'fly_api_failed',
  'provisioning_failed',
]);

type WorkspacePlan = 'starter' | 'team' | 'business';

type WorkspaceRuntime = 'provisioning' | 'overdue' | 'ready' | 'failed';

const PROVISIONING_OVERDUE_MS = 60 * 1000;

interface CurrentWorkspace {
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

export function deriveRuntime(input: {
  status: string;
  gbrainReady: boolean;
  provisioningStartedAt: Date;
  now?: Date;
}): WorkspaceRuntime {
  if (input.status === 'failed') return 'failed';
  if (input.status === 'ready' && input.gbrainReady) return 'ready';
  const elapsed = (input.now ?? new Date()).getTime() - input.provisioningStartedAt.getTime();
  if (elapsed > PROVISIONING_OVERDUE_MS) return 'overdue';
  return 'provisioning';
}

export function sanitizeProvisioningLastError(value: string | null): string | null {
  if (!value) return null;
  const code = value.split(':', 1)[0]?.trim() ?? '';
  return SAFE_PROVISIONING_ERROR_CODES.has(code) ? code : 'provisioning_failed';
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
}

export function buildWorkspaceProvisionRouter(
  deps: {
    provisionTenant?: typeof defaultProvisionTenant;
    safelyProvisionTenant?: typeof defaultSafelyProvisionTenant;
    repo?: WorkspaceLifecycleRepo;
    sendEmail?: typeof defaultSendEmail;
    generateInviteLink?: typeof defaultGenerateInviteLink;
  } = {},
) {
  const router = Router();
  const safelyProvisionTenant = deps.safelyProvisionTenant ?? defaultSafelyProvisionTenant;
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
      res.json(sanitizeCurrentPayload(current));
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
        // safelyProvisionTenant captures failures into the workspaces row instead of
        // swallowing the error — see /onboarding/retry-provision for the recovery path.
        void safelyProvisionTenant({ ownerUserId: session.userId });
      }
      res.json(sanitizeCurrentPayload(payload));
    } catch (err) {
      if (err instanceof Error && err.message === 'workspace_owner_required') {
        res.status(403).json({ error: 'workspace_owner_required' });
        return;
      }
      next(err);
    }
  });

  router.post('/onboarding/retry-provision', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      // Authorization claim comes from `memberships` (role='owner'), NOT
      // workspaces.owner_user_id directly. See apps/api/src/auth/membership.ts
      // (Codex ship-blocker #1) — the helper JOINs through memberships and
      // excludes soft-deleted workspaces.
      const ownedWorkspaceId = await resolveOwnerWorkspaceId(session.userId);
      if (!ownedWorkspaceId) {
        res.status(409).json({ error: 'no_workspace' });
        return;
      }

      const [workspace] = await db
        .select({ id: schema.workspaces.id, status: schema.workspaces.status })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, ownedWorkspaceId))
        .limit(1);

      if (!workspace) {
        res.status(409).json({ error: 'no_workspace' });
        return;
      }
      if (workspace.status === 'ready') {
        res.json({ ok: true, status: 'ready' });
        return;
      }

      await db
        .update(schema.workspaces)
        .set({
          status: 'provisioning',
          lastError: null,
          provisioningStartedAt: new Date(),
        })
        .where(eq(schema.workspaces.id, workspace.id));

      // Fire-and-forget — same async pattern as the initial provision, but
      // safelyProvisionTenant captures errors into the workspaces row.
      void safelyProvisionTenant({ ownerUserId: session.userId });

      res.status(202).json({ ok: true, status: 'provisioning' });
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
      res.json(payload ? { ...sanitizeCurrentPayload(payload), sent, failed } : { sent, failed });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function requireSession(
  req: Request,
  res: { status: (status: number) => { json: (body: unknown) => void } },
) {
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

        // Authorization claim comes from `memberships` (role='owner'), NOT
        // `users.currentWorkspaceId`. See apps/api/src/auth/membership.ts
        // (Codex ship-blocker #1).
        const [ownerRow] = await tx
          .select({ workspaceId: schema.memberships.workspaceId })
          .from(schema.memberships)
          .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
          .where(
            and(
              eq(schema.memberships.userId, userId),
              eq(schema.memberships.role, 'owner'),
              sql`${schema.workspaces.deletedAt} IS NULL`,
            ),
          )
          .limit(1);

        if (ownerRow?.workspaceId) {
          await tx
            .update(schema.workspaces)
            .set({ name })
            .where(eq(schema.workspaces.id, ownerRow.workspaceId));
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
      const ownerWorkspaceId = await resolveOwnerWorkspaceId(userId);
      if (!ownerWorkspaceId) throw new Error('workspace_owner_required');
      const current = await currentPayload(userId);
      if (!current?.workspace) throw new Error('workspace_required');
      if (current.workspace.id !== ownerWorkspaceId) throw new Error('workspace_owner_required');
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
  };
}

function sanitizeCurrentPayload(payload: CurrentPayload): CurrentPayload {
  if (!payload.workspace) return payload;
  return {
    ...payload,
    workspace: {
      ...payload.workspace,
      lastError: sanitizeProvisioningLastError(payload.workspace.lastError),
    },
  };
}

async function currentPayload(userId: string): Promise<CurrentPayload | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) return null;

  const workspace = await currentWorkspaceForUser(userId);
  const ownerWorkspaceId = workspace ? await resolveOwnerWorkspaceId(userId) : null;
  const invites =
    workspace && ownerWorkspaceId === workspace.id
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

export async function currentWorkspaceForUser(userId: string): Promise<CurrentWorkspace | null> {
  // Membership is the only authorization claim — see apps/api/src/auth/membership.ts
  // (Codex ship-blocker #1). The owner row also gets a membership at creation
  // time (saveWorkspaceName inserts both atomically), so the membership table
  // is sufficient on its own.
  const [row] = await db
    .select({ workspace: schema.workspaces })
    .from(schema.workspaces)
    .leftJoin(
      schema.memberships,
      and(
        eq(schema.memberships.workspaceId, schema.workspaces.id),
        eq(schema.memberships.userId, userId),
      ),
    )
    .where(and(eq(schema.memberships.userId, userId), sql`${schema.workspaces.deletedAt} IS NULL`))
    .limit(1);
  if (!row?.workspace) return null;
  const workspace = row.workspace;
  const gbrainReady = Boolean(
    (workspace.gbrainBaseUrl || workspace.flyPrivateIp) &&
    workspace.gbrainOauthClientId &&
    workspace.gbrainOauthClientSecretCiphertext,
  );
  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    status: workspace.status,
    gbrainReady,
    runtime: deriveRuntime({
      status: workspace.status,
      gbrainReady,
      provisioningStartedAt: workspace.provisioningStartedAt,
    }),
    lastError: sanitizeProvisioningLastError(workspace.lastError),
    provisionAttempts: workspace.provisionAttempts,
    provisioningStartedAt: workspace.provisioningStartedAt,
    createdAt: workspace.createdAt,
  };
}
