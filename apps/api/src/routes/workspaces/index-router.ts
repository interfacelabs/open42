import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import pino from 'pino';

import { type MembershipRole } from '../../auth/membership.js';
import { readSession } from '../../auth/session-helpers.js';
import { OWNER_SIGNUP_NOT_ALLOWED_ERROR } from '../../auth/signup-gate.js';
import { db, schema } from '../../db/client.js';
import { OPEN42_ALLOW_MULTI_WORKSPACE } from '../../env.js';
import { requireMembership } from '../../middleware/require-membership.js';
import { createWorkspaceForUser as defaultCreateWorkspaceForUser } from '../../workspaces/create.js';

const logger = pino({
  name: 'routes/workspaces/index-router',
  level: process.env.LOG_LEVEL ?? 'info',
});

const WORKSPACE_NAME_MAX = 80;

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > WORKSPACE_NAME_MAX) return null;
  return name;
}

export interface IndexRouterRepo {
  /**
   * Returns every workspace this user has a membership in (owner + joined),
   * filtering out soft-deleted workspaces. Sort order:
   *   - owner rows first (CASE WHEN role='owner' THEN 0 ELSE 1 END)
   *   - then `workspaces.created_at DESC`
   *
   * We sort in SQL rather than JS so a future paginated variant doesn't need
   * to fetch the full set into the API process.
   */
  listMembershipsForUser(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      role: MembershipRole;
      status: 'provisioning' | 'ready' | 'failed';
    }>
  >;
  /**
   * Update users.current_workspace_id unconditionally to the given id. Caller
   * has already gated on membership, so writing the UI hint is safe.
   */
  setCurrentWorkspace(userId: string, workspaceId: string): Promise<void>;
  /**
   * Read a workspace row by id, returning a thin shape for the switch
   * response. Returns null when the row does not exist or is soft-deleted.
   */
  findWorkspace(
    workspaceId: string,
  ): Promise<{ id: string; name: string; status: 'provisioning' | 'ready' | 'failed' } | null>;
  countActiveWorkspaces?(): Promise<number>;
}

export interface IndexRouterDeps {
  repo?: IndexRouterRepo;
  createWorkspaceForUser?: typeof defaultCreateWorkspaceForUser;
}

function defaultRepo(): IndexRouterRepo {
  return {
    async listMembershipsForUser(userId) {
      const rows = await db
        .select({
          id: schema.workspaces.id,
          name: schema.workspaces.name,
          role: schema.memberships.role,
          status: schema.workspaces.status,
        })
        .from(schema.memberships)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
        .where(
          and(eq(schema.memberships.userId, userId), sql`${schema.workspaces.deletedAt} IS NULL`),
        )
        .orderBy(
          sql`CASE WHEN ${schema.memberships.role} = 'owner' THEN 0 ELSE 1 END`,
          desc(schema.workspaces.createdAt),
        );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role as MembershipRole,
        status: r.status as 'provisioning' | 'ready' | 'failed',
      }));
    },
    async setCurrentWorkspace(userId, workspaceId) {
      await db
        .update(schema.users)
        .set({ currentWorkspaceId: workspaceId })
        .where(eq(schema.users.id, userId));
    },
    async findWorkspace(workspaceId) {
      const [row] = await db
        .select({
          id: schema.workspaces.id,
          name: schema.workspaces.name,
          status: schema.workspaces.status,
        })
        .from(schema.workspaces)
        .where(
          and(eq(schema.workspaces.id, workspaceId), sql`${schema.workspaces.deletedAt} IS NULL`),
        )
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        status: row.status as 'provisioning' | 'ready' | 'failed',
      };
    },
    async countActiveWorkspaces() {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.workspaces)
        .where(sql`${schema.workspaces.deletedAt} IS NULL`);
      return Number(row?.count ?? 0);
    },
  };
}

/**
 * Top-level workspace CRUD: list memberships, create a workspace, switch the
 * UI hint. Lives at the `/workspaces` mount alongside the legacy onboarding
 * router; mount order in `index.ts` keeps onboarding-specific subpaths
 * (`/onboarding/...`, `/current`) winning since Express tries each mounted
 * router in order and falls through on 404.
 *
 *   - GET  /            — any signed-in user; returns all their memberships
 *   - POST /            — any signed-in user; creates a workspace + enqueues
 *                         provisioning (multi-workspace per B2 spec)
 *   - POST /:id/switch  — any member of `:id` (gated by requireMembership);
 *                         sets users.current_workspace_id to `:id`
 *
 * `users.current_workspace_id` is the UI hint — it never gates authorization
 * (see apps/api/src/auth/membership.ts) — so the switch endpoint only needs
 * a membership claim, not a role check.
 */
export function buildWorkspaceIndexRouter(deps: IndexRouterDeps = {}) {
  const repo = deps.repo ?? defaultRepo();
  const createWorkspaceForUser = deps.createWorkspaceForUser ?? defaultCreateWorkspaceForUser;

  const router = Router({ mergeParams: true });

  // GET /workspaces — list every workspace the caller has a membership in.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await readSession(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const workspaces = await repo.listMembershipsForUser(session.userId);
      res.json({ workspaces, allowMultiWorkspace: OPEN42_ALLOW_MULTI_WORKSPACE });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces — create a new workspace owned by the caller.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await readSession(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const name = normalizeWorkspaceName(req.body?.name);
      if (!name) {
        res.status(400).json({ error: 'workspace_name_invalid' });
        return;
      }
      if (!OPEN42_ALLOW_MULTI_WORKSPACE && ((await repo.countActiveWorkspaces?.()) ?? 0) > 0) {
        res.status(403).json({ error: 'multi_workspace_disabled' });
        return;
      }
      const workspace = await createWorkspaceForUser(session.userId, name);
      logger.info({ workspace_id: workspace.id, user_id: session.userId }, 'workspace_created');
      res.status(201).json({ workspace });
    } catch (err) {
      if (err instanceof Error && err.message === OWNER_SIGNUP_NOT_ALLOWED_ERROR) {
        res.status(403).json({ error: OWNER_SIGNUP_NOT_ALLOWED_ERROR });
        return;
      }
      next(err);
    }
  });

  // POST /workspaces/:id/switch — any member can switch into a workspace.
  // The `requireMembership` middleware enforces session + membership and
  // populates `req.workspace` + `req.session` for the handler.
  router.post(
    '/:id/switch',
    requireMembership({ from: 'param' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const wsId = req.workspace!.id;
        const session = req.session!;

        const workspace = await repo.findWorkspace(wsId);
        if (!workspace) {
          // requireMembership should have caught a missing/soft-deleted row
          // (its join excludes deleted_at) but guard for the rare race where
          // the workspace is soft-deleted between gate and handler.
          res.status(404).json({ error: 'workspace_not_found' });
          return;
        }

        await repo.setCurrentWorkspace(session.userId, wsId);
        logger.info({ workspace_id: wsId, user_id: session.userId }, 'workspace_switched');
        res.json({ ok: true, workspace });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
