import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { type MembershipRole } from '../../auth/membership.js';
import { db, schema } from '../../db/client.js';
import { requireMembership } from '../../middleware/require-membership.js';
import { requireRole } from '../../middleware/require-role.js';

const logger = pino({ name: 'routes/workspaces/members', level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Repo functions the members router calls out to. Unit tests inject a fake
 * so they can assert behavior without standing up Postgres. The concrete
 * impl uses `db.select/update/delete` against the metadata schema.
 */
export interface MembersRouterRepo {
  listMembers(workspaceId: string): Promise<
    Array<{
      userId: string;
      email: string;
      role: MembershipRole;
      joinedAt: Date;
    }>
  >;
  findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: MembershipRole } | null>;
  updateMembershipRole(
    workspaceId: string,
    userId: string,
    role: MembershipRole,
  ): Promise<void>;
  deleteMembership(workspaceId: string, userId: string): Promise<void>;
  clearCurrentWorkspaceIfMatches(userId: string, workspaceId: string): Promise<void>;
}

export interface MembersRouterDeps {
  repo?: MembersRouterRepo;
}

function defaultRepo(): MembersRouterRepo {
  return {
    async listMembers(workspaceId) {
      const rows = await db
        .select({
          userId: schema.memberships.userId,
          email: schema.users.email,
          role: schema.memberships.role,
          joinedAt: schema.memberships.createdAt,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.workspaceId, workspaceId));
      return rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        role: r.role as MembershipRole,
        joinedAt: r.joinedAt,
      }));
    },
    async findMembership(workspaceId, userId) {
      const [row] = await db
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.workspaceId, workspaceId),
            eq(schema.memberships.userId, userId),
          ),
        )
        .limit(1);
      return row ? { role: row.role as MembershipRole } : null;
    },
    async updateMembershipRole(workspaceId, userId, role) {
      await db
        .update(schema.memberships)
        .set({ role })
        .where(
          and(
            eq(schema.memberships.workspaceId, workspaceId),
            eq(schema.memberships.userId, userId),
          ),
        );
    },
    async deleteMembership(workspaceId, userId) {
      await db
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.workspaceId, workspaceId),
            eq(schema.memberships.userId, userId),
          ),
        );
    },
    async clearCurrentWorkspaceIfMatches(userId, workspaceId) {
      // Side-effect: when the kicked user's `current_workspace_id` was this
      // workspace, null it. The UI then falls into the recovery flow on the
      // next request. We do not touch `current_workspace_id` for OTHER users.
      await db
        .update(schema.users)
        .set({ currentWorkspaceId: null })
        .where(
          and(
            eq(schema.users.id, userId),
            eq(schema.users.currentWorkspaceId, workspaceId),
          ),
        );
    },
  };
}

/**
 * Per-workspace member management router. Mounted at `/workspaces`; uses
 * the `:id` path param to identify the target workspace.
 *
 * Auth is layered via middleware:
 *   - GET uses `requireMembership({ from: 'param' })` — any member may list.
 *   - PATCH/DELETE use `requireRole(['owner','admin'], ..., 'forbidden_cannot_manage_members')`
 *     — only owners and admins may mutate the member set.
 *
 * Role mutation invariants (enforced inside the handler):
 *   - cannot self-modify (anti-footgun against accidental self-demotion)
 *   - cannot modify the owner row from this endpoint (transfer ownership
 *     is a separate, more deliberate flow — to be added later)
 *   - role is restricted to {admin, member} — promoting to owner is not
 *     possible via this endpoint by construction
 *
 * Kick invariants:
 *   - cannot self-kick
 *   - cannot kick the owner (regardless of caller role)
 *   - on success, null out the kicked user's `current_workspace_id` if it
 *     matched this workspace (UI recovery flow handles re-onboarding)
 */
export function buildMembersRouter(deps: MembersRouterDeps = {}) {
  const repo = deps.repo ?? defaultRepo();
  const router = Router({ mergeParams: true });

  const memberGate = requireMembership({ from: 'param' });
  const manageGate = requireRole(
    ['owner', 'admin'],
    { from: 'param' },
    'forbidden_cannot_manage_members',
  );

  // GET /:id/members — any member of the workspace can list.
  router.get('/:id/members', memberGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const members = await repo.listMembers(wsId);
      res.json({ members });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /:id/members/:userId — owner/admin only; switch role between
  // 'admin' and 'member'. The endpoint refuses to touch owner rows or the
  // caller's own row.
  router.patch('/:id/members/:userId', manageGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const session = req.session!;
      const targetUserId = req.params.userId;
      if (!targetUserId) {
        res.status(400).json({ error: 'user_id_required' });
        return;
      }

      if (targetUserId === session.userId) {
        res.status(403).json({ error: 'cannot_modify_self' });
        return;
      }

      const newRole = req.body?.role;
      if (newRole !== 'admin' && newRole !== 'member') {
        res.status(400).json({ error: 'role_invalid' });
        return;
      }

      const target = await repo.findMembership(wsId, targetUserId);
      if (!target) {
        res.status(404).json({ error: 'member_not_found' });
        return;
      }
      if (target.role === 'owner') {
        res.status(403).json({ error: 'cannot_modify_owner' });
        return;
      }

      await repo.updateMembershipRole(wsId, targetUserId, newRole as MembershipRole);
      logger.info(
        {
          workspace_id: wsId,
          actor_user_id: session.userId,
          target_user_id: targetUserId,
          role: newRole,
        },
        'member_role_updated',
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id/members/:userId — owner/admin only; kick a member or admin.
  // Refuses to kick the owner or the caller themselves. Nulls the target's
  // `current_workspace_id` if it matched this workspace.
  router.delete('/:id/members/:userId', manageGate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsId = req.workspace!.id;
      const session = req.session!;
      const targetUserId = req.params.userId;
      if (!targetUserId) {
        res.status(400).json({ error: 'user_id_required' });
        return;
      }

      if (targetUserId === session.userId) {
        res.status(403).json({ error: 'cannot_kick_self' });
        return;
      }

      const target = await repo.findMembership(wsId, targetUserId);
      if (!target) {
        res.status(404).json({ error: 'member_not_found' });
        return;
      }
      if (target.role === 'owner') {
        res.status(403).json({ error: 'cannot_kick_owner' });
        return;
      }

      await repo.deleteMembership(wsId, targetUserId);
      await repo.clearCurrentWorkspaceIfMatches(targetUserId, wsId);
      logger.info(
        {
          workspace_id: wsId,
          actor_user_id: session.userId,
          target_user_id: targetUserId,
        },
        'member_kicked',
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
