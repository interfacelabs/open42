import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import pino from 'pino';

import { generateInviteLink as defaultGenerateInviteLink } from '../../auth/supabase.js';
import { db, schema } from '../../db/client.js';
import { WEB_PUBLIC_URL } from '../../env.js';
import { renderInviteEmail } from '../../integrations/email-templates/invite.js';
import { sendEmail as defaultSendEmail } from '../../integrations/resend.js';
import {
  sendInvitesForWorkspace as defaultSendInvitesForWorkspace,
  type UpsertInvitesResult,
} from '../../invites/send-invites.js';
import {
  sharedResendRateLimiter,
  type ResendRateLimiter,
} from '../../invites/resend-rate-limit.js';
import { requireRole } from '../../middleware/require-role.js';

const logger = pino({ name: 'routes/workspaces/invites', level: process.env.LOG_LEVEL ?? 'info' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_LIMIT = 10;

/**
 * Repo functions the invites router calls out to. Concrete impl uses
 * `db.select/insert/update` against the metadata schema; the unit tests
 * inject fakes so they can assert behavior without standing up Postgres.
 */
export interface InvitesRouterRepo {
  fetchWorkspaceName(workspaceId: string): Promise<string | null>;
  fetchUserEmail(userId: string): Promise<string | null>;
  upsertInvitesForWorkspace(params: {
    workspaceId: string;
    inviterUserId: string;
    inviterEmail: string;
    emails: string[];
    role: 'admin' | 'member';
  }): Promise<UpsertInvitesResult>;
  listInvites(params: {
    workspaceId: string;
    status?: 'pending' | 'accepted' | 'revoked' | 'all';
  }): Promise<
    Array<{
      id: string;
      workspaceId: string;
      email: string;
      role: 'admin' | 'member' | 'owner';
      status: 'pending' | 'accepted' | 'revoked';
      createdAt: Date;
      invitedByUserId: string;
    }>
  >;
  findInvite(inviteId: string): Promise<
    | {
        id: string;
        workspaceId: string;
        email: string;
        role: 'admin' | 'member' | 'owner';
        status: 'pending' | 'accepted' | 'revoked';
        createdAt: Date;
      }
    | null
  >;
  touchInviteCreatedAt(inviteId: string): Promise<void>;
  revokeInvite(inviteId: string): Promise<void>;
}

export interface InvitesRouterDeps {
  repo?: InvitesRouterRepo;
  rateLimiter?: ResendRateLimiter;
  sendInvitesForWorkspace?: typeof defaultSendInvitesForWorkspace;
  generateInviteLink?: typeof defaultGenerateInviteLink;
  sendEmail?: typeof defaultSendEmail;
}

/**
 * Normalises a `req.body.emails` payload to a deduplicated, lower-cased
 * string[] suitable for `sendInvitesForWorkspace`. Returns `null` when the
 * input is not an array, empty, oversize, or contains a malformed address.
 *
 * The route emits 400 `invite_emails_invalid` on `null`; the helper itself
 * also validates and throws, but doing it here gives a cleaner error code
 * before we incur a DB roundtrip.
 */
function normalizeEmailsForSend(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = Array.from(
    new Set(
      value
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  );
  if (out.length === 0 || out.length > INVITE_LIMIT) return null;
  if (out.some((e) => !EMAIL_RE.test(e))) return null;
  return out;
}

function defaultRepo(): InvitesRouterRepo {
  return {
    async fetchWorkspaceName(workspaceId) {
      const [row] = await db
        .select({ name: schema.workspaces.name })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .limit(1);
      return row?.name ?? null;
    },
    async fetchUserEmail(userId) {
      const [row] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      return row?.email ?? null;
    },
    async upsertInvitesForWorkspace(params) {
      const inviterLower = params.inviterEmail.toLowerCase();
      const failed: Array<{ email: string; reason: string }> = [];

      // (1) self-invite filter — per-email skip, not whole-batch refusal.
      let candidates = params.emails.filter((email) => {
        if (email === inviterLower) {
          failed.push({ email, reason: 'cannot_invite_self' });
          return false;
        }
        return true;
      });

      // (2) already-member filter — JOIN memberships → users → email and
      // skip any email that already resolves to a member of this workspace.
      if (candidates.length > 0) {
        const existingMembers = await db
          .select({ email: schema.users.email })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(
            and(
              eq(schema.memberships.workspaceId, params.workspaceId),
              inArray(schema.users.email, candidates),
            ),
          );
        const memberSet = new Set(existingMembers.map((r) => r.email.toLowerCase()));
        candidates = candidates.filter((email) => {
          if (memberSet.has(email)) {
            failed.push({ email, reason: 'already_member' });
            return false;
          }
          return true;
        });
      }

      if (candidates.length === 0) return { invites: [], failed };

      // (3) upsert pending rows. The partial unique index on
      // (workspace_id, email) WHERE status='pending' is the conflict target —
      // re-inviting refreshes createdAt and rebinds invitedByUserId + role.
      const inserted = await db
        .insert(schema.workspaceInvites)
        .values(
          candidates.map((email) => ({
            workspaceId: params.workspaceId,
            invitedByUserId: params.inviterUserId,
            email,
            role: params.role,
            status: 'pending' as const,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.workspaceInvites.workspaceId, schema.workspaceInvites.email],
          targetWhere: sql`${schema.workspaceInvites.status} = 'pending'`,
          set: {
            invitedByUserId: params.inviterUserId,
            role: params.role,
            createdAt: sql`NOW()`,
          },
        })
        .returning();

      return {
        invites: inserted.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role as 'admin' | 'member',
          status: 'pending' as const,
          createdAt: r.createdAt,
        })),
        failed,
      };
    },
    async listInvites({ workspaceId, status }) {
      const filter =
        status === 'all' || status === undefined
          ? eq(schema.workspaceInvites.workspaceId, workspaceId)
          : and(
              eq(schema.workspaceInvites.workspaceId, workspaceId),
              eq(schema.workspaceInvites.status, status),
            );
      const rows = await db
        .select()
        .from(schema.workspaceInvites)
        .where(filter)
        .orderBy(sql`${schema.workspaceInvites.createdAt} DESC`);
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        email: r.email,
        role: r.role as 'admin' | 'member' | 'owner',
        status: r.status as 'pending' | 'accepted' | 'revoked',
        createdAt: r.createdAt,
        invitedByUserId: r.invitedByUserId,
      }));
    },
    async findInvite(inviteId) {
      const [row] = await db
        .select()
        .from(schema.workspaceInvites)
        .where(eq(schema.workspaceInvites.id, inviteId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        email: row.email,
        role: row.role as 'admin' | 'member' | 'owner',
        status: row.status as 'pending' | 'accepted' | 'revoked',
        createdAt: row.createdAt,
      };
    },
    async touchInviteCreatedAt(inviteId) {
      await db
        .update(schema.workspaceInvites)
        .set({ createdAt: new Date() })
        .where(eq(schema.workspaceInvites.id, inviteId));
    },
    async revokeInvite(inviteId) {
      // Status-guarded UPDATE (codex round-7 P2): the handler's earlier
      // `findInvite` → check-then-update is not atomic. A parallel accept
      // can read status='pending', enter its FOR-UPDATE transaction, and
      // commit `accepted` while this revoke is still waiting on the row
      // lock. Without the WHERE-status='pending' guard the revoke would
      // then clobber the accepted row, leaving status='revoked' alongside
      // an existing membership. The guarded UPDATE no-ops in that case;
      // callers should re-read to distinguish "revoked" from
      // "concurrent accept won".
      await db
        .update(schema.workspaceInvites)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(schema.workspaceInvites.id, inviteId),
            eq(schema.workspaceInvites.status, 'pending'),
          ),
        );
    },
  };
}

/**
 * Per-workspace invite CRUD router. Mounts under `/workspaces`; the path
 * shape is `/:id/invites[...]` so the workspace id is always supplied via
 * the route, never via `users.currentWorkspaceId` (which is a UI hint and
 * never trusted for authorization — see auth/membership.ts).
 *
 * Session validation + membership lookup + role assertion are all handled
 * by the `requireRole` middleware factory (which layers on top of
 * `requireMembership`). Handlers read `req.workspace!.id` and
 * `req.session!.userId` directly.
 */
export function buildInvitesRouter(deps: InvitesRouterDeps = {}) {
  const repo = deps.repo ?? defaultRepo();
  const rateLimiter = deps.rateLimiter ?? sharedResendRateLimiter;
  const sendInvitesForWorkspace = deps.sendInvitesForWorkspace ?? defaultSendInvitesForWorkspace;
  const generateInviteLink = deps.generateInviteLink ?? defaultGenerateInviteLink;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;

  const router = Router({ mergeParams: true });

  const inviteGate = requireRole(['owner', 'admin'], { from: 'param' }, 'forbidden_cannot_invite');

  // POST /:id/invites — invite a batch of emails to the workspace.
  router.post('/:id/invites', inviteGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const session = req.session!;

      const emails = normalizeEmailsForSend(req.body?.emails);
      if (!emails) {
        res.status(400).json({ error: 'invite_emails_invalid' });
        return;
      }
      const role: 'admin' | 'member' = req.body?.role === 'admin' ? 'admin' : 'member';

      const workspaceName = await repo.fetchWorkspaceName(wsId);
      if (!workspaceName) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      const inviterEmail = await repo.fetchUserEmail(session.userId);
      if (!inviterEmail) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const result = await sendInvitesForWorkspace(
        {
          workspaceId: wsId,
          workspaceName,
          inviterUserId: session.userId,
          inviterEmail,
          emails,
          role,
          webBaseUrl: WEB_PUBLIC_URL,
        },
        {
          generateInviteLink,
          sendEmail,
          upsertInvitesForWorkspace: (params) => repo.upsertInvitesForWorkspace(params),
        },
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /:id/invites — list invites (pending by default; ?status=all for all).
  router.get('/:id/invites', inviteGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;

      const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'pending';
      const status: 'pending' | 'accepted' | 'revoked' | 'all' =
        rawStatus === 'all' || rawStatus === 'accepted' || rawStatus === 'revoked'
          ? rawStatus
          : 'pending';
      const invites = await repo.listInvites({ workspaceId: wsId, status });
      res.json({ invites });
    } catch (err) {
      next(err);
    }
  });

  // POST /:id/invites/:inviteId/resend — re-issue the link + re-send email.
  router.post('/:id/invites/:inviteId/resend', inviteGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const session = req.session!;
      const inviteId = req.params.inviteId;
      if (!inviteId) {
        res.status(400).json({ error: 'invite_id_required' });
        return;
      }

      const invite = await repo.findInvite(inviteId);
      if (!invite || invite.workspaceId !== wsId) {
        res.status(404).json({ error: 'invite_not_found' });
        return;
      }
      if (invite.status !== 'pending') {
        const code =
          invite.status === 'accepted'
            ? 'invite_already_accepted'
            : invite.status === 'revoked'
              ? 'invite_revoked'
              : 'invite_invalid_status';
        res.status(409).json({ error: code });
        return;
      }

      const rl = rateLimiter.check(inviteId);
      if (!rl.allowed) {
        logger.warn(
          {
            invite_id: inviteId,
            actor_user_id: session.userId,
            retry_after_ms: rl.retryAfterMs,
          },
          'invite_resend_throttled',
        );
        res.setHeader('Retry-After', Math.ceil((rl.retryAfterMs ?? 60_000) / 1000));
        res.status(429).json({ error: 'rate_limited', retry_after_ms: rl.retryAfterMs });
        return;
      }

      const workspaceName = await repo.fetchWorkspaceName(wsId);
      if (!workspaceName) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      const inviterEmail = await repo.fetchUserEmail(session.userId);
      if (!inviterEmail) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const webBase = WEB_PUBLIC_URL;
      try {
        const { actionLink } = await generateInviteLink({
          email: invite.email,
          redirectTo: `${webBase}/auth/invite/accept?invite_id=${invite.id}`,
        });
        const rendered = renderInviteEmail({ workspaceName, inviterEmail, inviteUrl: actionLink });
        const sendResult = await sendEmail({
          to: invite.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (!sendResult.ok) {
          logger.warn(
            { invite_id: inviteId, actor_user_id: session.userId, err: sendResult.error },
            'invite_resend_send_failed',
          );
          res.status(502).json({ error: 'email_send_failed' });
          return;
        }
      } catch (err) {
        logger.warn(
          {
            invite_id: inviteId,
            actor_user_id: session.userId,
            err: err instanceof Error ? err.message : 'unknown',
          },
          'invite_resend_link_failed',
        );
        res.status(502).json({ error: 'invite_link_failed' });
        return;
      }

      await repo.touchInviteCreatedAt(inviteId);
      logger.info({ invite_id: inviteId, actor_user_id: session.userId }, 'invite_resent');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id/invites/:inviteId — revoke a pending invite.
  router.delete('/:id/invites/:inviteId', inviteGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const session = req.session!;
      const inviteId = req.params.inviteId;
      if (!inviteId) {
        res.status(400).json({ error: 'invite_id_required' });
        return;
      }

      const invite = await repo.findInvite(inviteId);
      if (!invite || invite.workspaceId !== wsId) {
        res.status(404).json({ error: 'invite_not_found' });
        return;
      }
      if (invite.status === 'accepted') {
        res.status(409).json({ error: 'invite_already_accepted' });
        return;
      }
      if (invite.status === 'revoked') {
        // Idempotent — already revoked is a no-op success.
        res.json({ ok: true });
        return;
      }

      await repo.revokeInvite(inviteId);

      // Race recovery (codex round-7 P2): the status-guarded UPDATE in
      // revokeInvite no-ops if a concurrent accept committed first. Re-read
      // to confirm the final state — if the invite is now `accepted`,
      // surface that fact so the admin UI can refresh "Pending invites"
      // and show the new member instead of pretending the revoke succeeded.
      const updated = await repo.findInvite(inviteId);
      if (updated?.status === 'accepted') {
        res.status(409).json({ error: 'invite_already_accepted' });
        return;
      }
      logger.info({ invite_id: inviteId, actor_user_id: session.userId }, 'invite_revoked');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
