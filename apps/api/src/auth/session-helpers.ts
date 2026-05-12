import type { Request } from 'express';

import { validateSession } from './sessions.js';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'open42_session';

/**
 * Reads the session cookie off the Express request, validates it via
 * `validateSession`, and returns a `{ id, userId }` shape (or `null` when
 * there is no cookie / the cookie does not resolve to a live session).
 *
 * Extracted from per-route inline helpers so every workspace router speaks
 * the same vocabulary. Keep this thin — anything heavier belongs in
 * `requireMembership` or `assertWorkspaceMembership`.
 */
export async function readSession(req: Request): Promise<{ id: string; userId: string } | null> {
  const cookie = (req as Request & { cookies?: Record<string, string | undefined> }).cookies?.[
    SESSION_COOKIE
  ];
  if (!cookie) return null;
  const result = await validateSession(cookie, {
    userAgent: req.header('user-agent') ?? undefined,
  });
  return result ? { id: result.id, userId: result.userId } : null;
}
