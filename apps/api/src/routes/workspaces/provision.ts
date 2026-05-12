import { and, desc, eq, sql } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';

import { resolveOwnerWorkspaceId } from '../../auth/membership.js';
import { generateInviteLink as defaultGenerateInviteLink } from '../../auth/supabase.js';
import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { sendInvitesForWorkspace } from '../../invites/send-invites.js';
import { sendEmail as defaultSendEmail } from '../../integrations/resend.js';
import { requireRole } from '../../middleware/require-role.js';
import {
  enqueueProvisionJob as defaultEnqueueProvisionJob,
  removeAndEnqueueProvisionJob as defaultRetryProvisionJob,
} from '../../queue/provision-queue.js';
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
  /**
   * Fetch a non-soft-deleted workspace row by id for the retry endpoint.
   * Returns null when the workspace doesn't exist or has been soft-deleted.
   * Authorization (membership/role) is enforced by middleware *before* this
   * call — the repo trusts the caller.
   */
  findRetryableWorkspace(
    workspaceId: string,
  ): Promise<{ id: string; status: string } | null>;
  /**
   * Reset a workspace to the provisioning state ahead of re-enqueue. Idempotent
   * — repeated calls are safe.
   */
  markWorkspaceProvisioning(workspaceId: string): Promise<void>;
}

export function buildWorkspaceProvisionRouter(
  deps: {
    provisionTenant?: typeof defaultProvisionTenant;
    safelyProvisionTenant?: typeof defaultSafelyProvisionTenant;
    enqueueProvisionJob?: typeof defaultEnqueueProvisionJob;
    retryProvisionJob?: typeof defaultRetryProvisionJob;
    repo?: WorkspaceLifecycleRepo;
    sendEmail?: typeof defaultSendEmail;
    generateInviteLink?: typeof defaultGenerateInviteLink;
  } = {},
) {
  const router = Router();
  // Tests can still inject `safelyProvisionTenant` to bypass the queue.
  const safelyProvisionTenant = deps.safelyProvisionTenant ?? defaultSafelyProvisionTenant;
  const enqueueProvisionJob = deps.enqueueProvisionJob ?? defaultEnqueueProvisionJob;
  const retryProvisionJob = deps.retryProvisionJob ?? defaultRetryProvisionJob;
  const repo = deps.repo ?? createDrizzleWorkspaceLifecycleRepo();
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const generateInviteLink = deps.generateInviteLink ?? defaultGenerateInviteLink;
  // Allow tests that already inject `safelyProvisionTenant` to keep working
  // — if they do, we treat that as "skip the queue, run inline".
  const useInlineProvision = deps.safelyProvisionTenant != null;

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
        // Provisioning runs as a BullMQ job (Redis-backed). The job survives
        // process death — if the API restarts mid-provision, BullMQ's
        // stalled-job recovery picks it up. Fire-and-forget over an in-process
        // Promise (the previous design) lost work on every crash.
        if (useInlineProvision) {
          void safelyProvisionTenant({
            workspaceId: payload.workspace.id,
            ownerUserId: session.userId,
          });
        } else {
          await enqueueProvisionJob({
            workspaceId: payload.workspace.id,
            ownerUserId: session.userId,
          });
        }
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

  // Codex round-4 P2: retry now takes workspace_id in the body. Previously
  // the handler resolved one owner workspace via resolveOwnerWorkspaceId with
  // LIMIT 1 and undefined ordering — with multi-workspace (B2) a user may
  // own a failed workspace AND another working one, so retry must target
  // the specific workspace the UI is rendering as failed.
  //
  // Authorization: only owners retry. requireRole runs requireMembership
  // first (validates session + membership), then asserts role='owner'.
  // Missing workspace_id → 400. Non-member or non-owner → 403.
  const retryGate = requireRole(['owner'], { from: 'body' }, 'forbidden_cannot_retry');
  router.post(
    '/onboarding/retry-provision',
    retryGate,
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.workspace!.id;
      const session = req.session!;

      const workspace = await repo.findRetryableWorkspace(workspaceId);
      if (!workspace) {
        // requireMembership already ruled out missing/soft-deleted workspaces
        // for non-members; getting here would mean a race (workspace deleted
        // mid-flight). Return 404 rather than 409 for consistency.
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      if (workspace.status === 'ready') {
        res.json({ ok: true, status: 'ready' });
        return;
      }

      await repo.markWorkspaceProvisioning(workspace.id);

      // Drop any prior job (terminal or active) and enqueue a fresh one. The
      // worker resets `provisioning_started_at` on its first attempt as well
      // — that's belt-and-suspenders for the rare race where the user clicks
      // retry while a final retry is already mid-flight.
      if (useInlineProvision) {
        void safelyProvisionTenant({
          workspaceId: workspace.id,
          ownerUserId: session.userId,
        });
      } else {
        await retryProvisionJob({
          workspaceId: workspace.id,
          ownerUserId: session.userId,
        });
      }

      res.status(202).json({ ok: true, status: 'provisioning' });
    } catch (err) {
      next(err);
    }
    },
  );

  router.post('/onboarding/invites', async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;
      const emails = normalizeInviteEmails(req.body?.emails);
      if (!emails) {
        res.status(400).json({ error: 'invite_emails_invalid' });
        return;
      }

      // Empty submission is a no-op (the onboarding UX uses this to skip the
      // invite step). Returning here avoids `sendInvitesForWorkspace` throwing
      // `invite_emails_required`, which the global error handler used to map
      // to 500 — pre-refactor behavior was 200 + sent=0 (codex round-3 P2).
      if (emails.length === 0) {
        const payload = await repo.current(session.userId);
        res.json(
          payload
            ? { ...sanitizeCurrentPayload(payload), sent: 0, failed: 0 }
            : { sent: 0, failed: 0 },
        );
        return;
      }

      // The legacy onboarding-route contract: `repo.upsertInvites` resolves
      // the owner workspace via `resolveOwnerWorkspaceId`, returns
      // workspaceName/inviterEmail, and writes pending rows with the
      // partial-unique-index upsert. The link-generation + email-send loop
      // moved into `sendInvitesForWorkspace` (apps/api/src/invites/send-invites.ts)
      // so this route and the new per-workspace invites router share one
      // implementation. The `upsertInvitesForWorkspace` shim here is a
      // pass-through — the actual upsert ran in `repo.upsertInvites` above.
      const upserted = await repo.upsertInvites(session.userId, emails);
      const result = await sendInvitesForWorkspace(
        {
          workspaceId: upserted.workspaceId,
          workspaceName: upserted.workspaceName,
          inviterUserId: session.userId,
          inviterEmail: upserted.inviterEmail,
          emails,
          role: 'member',
          webBaseUrl: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
        },
        {
          generateInviteLink,
          sendEmail,
          upsertInvitesForWorkspace: async () => ({
            invites: upserted.invites.map((r) => ({
              id: r.id,
              email: r.email,
              role: 'member' as const,
              status: 'pending' as const,
              // Legacy `InviteRow` shape carried no createdAt; the helper
              // only reads `invite.id` + `invite.email` from this payload.
              createdAt: new Date(),
            })),
            failed: [],
          }),
        },
      );

      const payload = await repo.current(session.userId);
      // Legacy contract: `sent` and `failed` are numbers, not arrays.
      const sent = result.sent;
      const failed = result.failed.length;
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
            gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
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
    async findRetryableWorkspace(workspaceId) {
      const [row] = await db
        .select({ id: schema.workspaces.id, status: schema.workspaces.status })
        .from(schema.workspaces)
        .where(
          and(
            eq(schema.workspaces.id, workspaceId),
            sql`${schema.workspaces.deletedAt} IS NULL`,
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async markWorkspaceProvisioning(workspaceId) {
      await db
        .update(schema.workspaces)
        .set({
          status: 'provisioning',
          lastError: null,
          provisioningStartedAt: new Date(),
        })
        .where(eq(schema.workspaces.id, workspaceId));
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
  // Resolution order (Codex round-2 P1):
  //   1. If users.current_workspace_id points at a workspace the user has a
  //      membership in (and the workspace isn't soft-deleted) → return that.
  //   2. Otherwise → fall back to "first owned, then first joined" — sorted
  //      by role (owner first) then created_at DESC, matching the order used
  //      by GET /workspaces.
  //   3. If the hint was stale (non-null but no membership / soft-deleted),
  //      self-heal users.current_workspace_id to the fallback pick so the
  //      column converges.
  //
  // Membership is the only authorization claim — see apps/api/src/auth/membership.ts
  // (Codex ship-blocker #1). users.current_workspace_id is a UI hint and is
  // only honored here to *select* among workspaces the user already has a
  // membership in — it never grants access on its own.

  // Step 1: try the hint. Single query: join users → memberships → workspaces
  // filtered by users.current_workspace_id; returns at most one row.
  const [hintRow] = await db
    .select({ workspace: schema.workspaces })
    .from(schema.users)
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.userId, schema.users.id),
        eq(schema.memberships.workspaceId, schema.users.currentWorkspaceId),
      ),
    )
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(and(eq(schema.users.id, userId), sql`${schema.workspaces.deletedAt} IS NULL`))
    .limit(1);

  if (hintRow?.workspace) {
    return toCurrentWorkspace(hintRow.workspace);
  }

  // Step 2: fallback — first owned, then first joined.
  const [fallbackRow] = await db
    .select({ workspace: schema.workspaces, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(and(eq(schema.memberships.userId, userId), sql`${schema.workspaces.deletedAt} IS NULL`))
    .orderBy(
      sql`CASE WHEN ${schema.memberships.role} = 'owner' THEN 0 ELSE 1 END`,
      desc(schema.workspaces.createdAt),
    )
    .limit(1);

  if (!fallbackRow?.workspace) return null;

  // Step 3: self-heal — if the user had a hint but it pointed at a workspace
  // we couldn't honor (stale / soft-deleted / they were kicked), write the
  // fallback pick back to users.current_workspace_id so the column converges.
  // Best-effort; failure to update doesn't change the response.
  try {
    await db
      .update(schema.users)
      .set({ currentWorkspaceId: fallbackRow.workspace.id })
      .where(eq(schema.users.id, userId));
  } catch {
    // swallow — the response is correct even if the write fails.
  }

  return toCurrentWorkspace(fallbackRow.workspace);
}

function toCurrentWorkspace(workspace: typeof schema.workspaces.$inferSelect): CurrentWorkspace {
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
