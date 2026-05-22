import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';

import { readSession } from '../../auth/session-helpers.js';
import { db, schema } from '../../db/client.js';

const logger = pino({
  name: 'routes/workspaces/accept',
  level: process.env.LOG_LEVEL ?? 'info',
});

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Thin workspace shape returned to the client on successful acceptance.
 */
export interface AcceptedWorkspace {
  id: string;
  name: string;
  status: 'billing_required' | 'provisioning' | 'ready' | 'failed';
}

/**
 * Discriminated-union result the repo's `acceptInvite` returns. The router
 * maps each `kind` to a specific HTTP status + error code. Keeping the
 * decisions inside the repo (not the route) lets us run the entire
 * transaction in one place — both for production (a real DB tx with
 * SELECT ... FOR UPDATE) and for tests (a fake repo returning a chosen
 * `kind`).
 */
export type AcceptResult =
  | { kind: 'not_found' }
  | { kind: 'workspace_not_found' }
  | { kind: 'user_not_found' }
  | { kind: 'email_mismatch' }
  | { kind: 'revoked' }
  | { kind: 'already_accepted' }
  | { kind: 'expired' }
  | { kind: 'ok'; workspace: AcceptedWorkspace };

export interface AcceptRouterRepo {
  /**
   * Open a transaction, lock the invite row (`SELECT ... FOR UPDATE`),
   * validate it against the caller's session user, and — if all gates pass —
   * insert a membership at the invite's role, mark the invite accepted, and
   * set the user's `current_workspace_id` to the workspace.
   *
   * Idempotency: if the user is already a member of the workspace, the
   * function returns `ok` (updating `current_workspace_id`) regardless of
   * the invite's current status (pending/accepted/revoked). This makes
   * double-click + re-click flows a stable no-op success.
   */
  acceptInvite(inviteId: string, userId: string): Promise<AcceptResult>;
}

export interface AcceptRouterDeps {
  repo?: AcceptRouterRepo;
}

export function defaultRepo(): AcceptRouterRepo {
  return {
    async acceptInvite(inviteId, userId) {
      return db.transaction(async (tx): Promise<AcceptResult> => {
        // Row-lock the invite so concurrent accepts of the same invite
        // serialise here. Without FOR UPDATE two parallel clicks could both
        // observe `status='pending'` and race past the status check.
        const [invite] = await tx
          .select()
          .from(schema.workspaceInvites)
          .where(eq(schema.workspaceInvites.id, inviteId))
          .for('update')
          .limit(1);
        if (!invite) return { kind: 'not_found' };

        const [ws] = await tx
          .select({
            id: schema.workspaces.id,
            name: schema.workspaces.name,
            status: schema.workspaces.status,
          })
          .from(schema.workspaces)
          .where(
            and(
              eq(schema.workspaces.id, invite.workspaceId),
              sql`${schema.workspaces.deletedAt} IS NULL`,
            ),
          )
          .limit(1);
        if (!ws) return { kind: 'workspace_not_found' };

        const [user] = await tx
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        if (!user) return { kind: 'user_not_found' };

        if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
          return { kind: 'email_mismatch' };
        }

        // Already-member shortcut. This wins over status/expiry checks: a
        // re-clicked link from a user who's already in the workspace is a
        // no-op success (idempotent), and we still update the UI hint so
        // they land on the right workspace.
        const [existing] = await tx
          .select({ userId: schema.memberships.userId })
          .from(schema.memberships)
          .where(
            and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, ws.id)),
          )
          .limit(1);
        if (existing) {
          // If a pending invite row still exists for this (workspace, email)
          // — e.g. admin added the user out-of-band, or a parallel accept
          // beat us to inserting the membership — flip it to `accepted` so
          // it stops surfacing in the admin's "Pending invites" UI as a
          // stale row. Status guard prevents clobbering an already-revoked
          // or already-accepted invite.
          await tx
            .update(schema.workspaceInvites)
            .set({ status: 'accepted' })
            .where(
              and(
                eq(schema.workspaceInvites.id, inviteId),
                eq(schema.workspaceInvites.status, 'pending'),
              ),
            );
          await tx
            .update(schema.users)
            .set({ currentWorkspaceId: ws.id })
            .where(eq(schema.users.id, userId));
          return {
            kind: 'ok',
            workspace: {
              id: ws.id,
              name: ws.name,
              status: ws.status as 'billing_required' | 'provisioning' | 'ready' | 'failed',
            },
          };
        }

        if (invite.status === 'revoked') return { kind: 'revoked' };
        if (invite.status === 'accepted') return { kind: 'already_accepted' };

        if (Date.now() - invite.createdAt.getTime() > INVITE_TTL_MS) {
          return { kind: 'expired' };
        }

        // Conflict-safe insert: if a parallel accept beat us between the
        // already-member check and here, ON CONFLICT DO NOTHING keeps the
        // operation a no-op rather than a 500.
        await tx
          .insert(schema.memberships)
          .values({
            workspaceId: ws.id,
            userId,
            role: invite.role,
          })
          .onConflictDoNothing();

        await tx
          .update(schema.workspaceInvites)
          .set({ status: 'accepted' })
          .where(eq(schema.workspaceInvites.id, inviteId));

        await tx
          .update(schema.users)
          .set({ currentWorkspaceId: ws.id })
          .where(eq(schema.users.id, userId));

        return {
          kind: 'ok',
          workspace: {
            id: ws.id,
            name: ws.name,
            status: ws.status as 'billing_required' | 'provisioning' | 'ready' | 'failed',
          },
        };
      });
    },
  };
}

/**
 * Signed-in invite-accept fast path. Mounts at `/workspaces`; exposes a
 * single endpoint:
 *
 *   POST /invites/:inviteId/accept
 *
 * Path B (per spec D4): when the user is already signed in and clicks an
 * invite link, the web app calls this endpoint instead of going through
 * `/auth/verify` (which is the Path A — OTP — flow). The invite id is the
 * workspace claim; the session is the identity claim. There is no
 * `workspaceId` in the body: the invite row carries it.
 *
 * The endpoint deliberately does NOT use `requireMembership` —
 * acceptance is precisely the operation that creates the membership row.
 *
 * Edge cases (spec D5):
 *   - 401 no session
 *   - 404 invite_not_found / workspace_not_found
 *   - 403 invite_email_mismatch
 *   - 409 invite_revoked / invite_already_accepted (but caller-already-member
 *     wins and returns 200 idempotently)
 *   - 400 invite_expired (server-side 24h check, independent of Supabase TTL)
 */
export function buildAcceptRouter(deps: AcceptRouterDeps = {}) {
  const repo = deps.repo ?? defaultRepo();
  const router = Router();

  router.post(
    '/invites/:inviteId/accept',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const session = await readSession(req);
        if (!session) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }

        const inviteId = req.params.inviteId;
        if (!inviteId) {
          res.status(400).json({ error: 'invite_id_required' });
          return;
        }

        const result = await repo.acceptInvite(inviteId, session.userId);

        switch (result.kind) {
          case 'not_found':
            res.status(404).json({ error: 'invite_not_found' });
            return;
          case 'workspace_not_found':
            res.status(404).json({ error: 'workspace_not_found' });
            return;
          case 'user_not_found':
            res.status(401).json({ error: 'unauthorized' });
            return;
          case 'email_mismatch':
            res.status(403).json({ error: 'invite_email_mismatch' });
            return;
          case 'revoked':
            res.status(409).json({ error: 'invite_revoked' });
            return;
          case 'already_accepted':
            res.status(409).json({ error: 'invite_already_accepted' });
            return;
          case 'expired':
            res.status(400).json({ error: 'invite_expired' });
            return;
          case 'ok':
            logger.info(
              {
                invite_id: inviteId,
                actor_user_id: session.userId,
                workspace_id: result.workspace.id,
              },
              'invite_accepted',
            );
            res.json({ ok: true, workspace: result.workspace });
            return;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
