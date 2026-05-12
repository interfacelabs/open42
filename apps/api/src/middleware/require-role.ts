import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { MembershipRole } from '../auth/membership.js';
import { requireMembership, type RequireMembershipOptions } from './require-membership.js';

/**
 * Layered Express middleware: runs `requireMembership` first (validates the
 * session cookie, resolves the workspace id, asserts a real membership row,
 * and attaches `req.workspace` + `req.session`), then asserts that
 * `req.workspace.role` is in `allowedRoles`.
 *
 * Returns 403 `{ error: errorCode }` when the user is a member but lacks the
 * required role. 401/403/400 responses from `requireMembership` itself are
 * propagated as-is.
 *
 * Returned as an array of two middlewares — Express accepts an array of
 * handlers wherever a single handler is expected, so callers can drop the
 * result directly into `router.METHOD(path, requireRole(...), handler)`.
 *
 * @example
 *   router.post(
 *     '/:id/invites',
 *     requireRole(['owner', 'admin'], { from: 'param' }, 'forbidden_cannot_invite'),
 *     handler,
 *   );
 */
export function requireRole(
  allowedRoles: readonly MembershipRole[],
  opts: RequireMembershipOptions,
  errorCode = 'forbidden',
): RequestHandler[] {
  const baseMiddleware = requireMembership(opts);
  const roleGate: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const role = req.workspace?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: errorCode });
      return;
    }
    next();
  };
  return [baseMiddleware, roleGate];
}
