import type { NextFunction, Request, Response } from 'express';

import { assertWorkspaceMembership } from '../auth/membership.js';
import { validateSession } from '../auth/sessions.js';

export type WorkspaceIdSource = 'param' | 'body' | 'query';

export interface RequireMembershipOptions {
  from: WorkspaceIdSource;
  /** Param/body/query key. Defaults: param='id', body='workspace_id', query='workspace_id'. */
  key?: string;
}

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'open42_session';

async function sessionFromCookies(req: Request): Promise<{ id: string; userId: string } | null> {
  const cookies = (req as Request & { cookies?: Record<string, string | undefined> }).cookies;
  const cookie = cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  const result = await validateSession(cookie, {
    userAgent: req.header('user-agent') ?? undefined,
  });
  if (!result) return null;
  return { id: result.id, userId: result.userId };
}

function readWorkspaceId(req: Request, opts: RequireMembershipOptions): string | null {
  switch (opts.from) {
    case 'param': {
      const key = opts.key ?? 'id';
      const v = req.params[key];
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    }
    case 'body': {
      const key = opts.key ?? 'workspace_id';
      const v = (req.body as Record<string, unknown> | undefined)?.[key];
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    }
    case 'query': {
      const key = opts.key ?? 'workspace_id';
      const v = req.query[key];
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    }
  }
}

/**
 * Express middleware that enforces "the session user has a real membership in
 * the workspace id taken from this request". Reads the session cookie inline
 * (does not depend on a separate auth middleware running first), then routes
 * the lookup through `assertWorkspaceMembership` so a corrupt
 * `users.currentWorkspaceId` cannot grant access.
 *
 * On success, attaches `req.workspace = { id, role }` and `req.session` so
 * downstream handlers don't re-read the session.
 *
 * Responses:
 *   - 401 `{ error: 'unauthorized' }` when no/invalid session cookie.
 *   - 400 `{ error: 'workspace_id_required' }` when the workspace id is missing.
 *   - 403 `{ error: <code> }` when the user has no membership (or lacks role).
 */
export function requireMembership(opts: RequireMembershipOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await sessionFromCookies(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const workspaceId = readWorkspaceId(req, opts);
      if (!workspaceId) {
        res.status(400).json({ error: 'workspace_id_required' });
        return;
      }
      const { role } = await assertWorkspaceMembership(session.userId, workspaceId);
      req.workspace = { id: workspaceId, role };
      req.session = session;
      next();
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const code = (err as { code?: string }).code ?? 'internal_error';
      if (status === 403) {
        res.status(403).json({ error: code });
        return;
      }
      next(err);
    }
  };
}
