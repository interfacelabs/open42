import type { NextFunction, Request, Response } from 'express';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfOptions {
  allowedOrigins: string[];
  sessionCookieName?: string;
  csrfCookieName?: string;
}

// Unauthenticated entry points: paths that start a fresh auth flow and never
// read the session cookie. A stale session cookie left over from a prior login
// must not gate them on a token the client cannot have.
const UNAUTH_ENTRY_PATHS = new Set(['/auth/signin', '/auth/verify']);

export function csrfMiddleware(options: CsrfOptions) {
  const sessionCookieName = options.sessionCookieName ?? 'open42_session';
  const csrfCookieName = options.csrfCookieName ?? 'open42_csrf';
  const allowedOrigins = new Set(options.allowedOrigins.map((origin) => origin.replace(/\/+$/, '')));

  return function csrf(req: Request, res: Response, next: NextFunction) {
    if (!MUTATION_METHODS.has(req.method)) return next();

    const origin = req.header('origin');
    if (!origin || !allowedOrigins.has(origin.replace(/\/+$/, ''))) {
      res.status(403).json({ error: 'csrf_origin_rejected' });
      return;
    }

    const fetchSite = req.header('sec-fetch-site');
    if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
      res.status(403).json({ error: 'csrf_fetch_site_rejected' });
      return;
    }

    if (UNAUTH_ENTRY_PATHS.has(req.path)) return next();

    const hasSession = Boolean(req.cookies?.[sessionCookieName]);
    if (!hasSession) return next();

    const csrfCookie = req.cookies?.[csrfCookieName];
    const csrfHeader = req.header('x-csrf-token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      res.status(403).json({ error: 'csrf_token_invalid' });
      return;
    }

    next();
  };
}

export function setSessionCookies(
  res: Response,
  session: { id: string; csrfToken: string; expiresAt: Date },
  options: { sessionCookieName?: string; csrfCookieName?: string } = {},
): void {
  const sessionCookieName = options.sessionCookieName ?? 'open42_session';
  const csrfCookieName = options.csrfCookieName ?? 'open42_csrf';
  const secure = process.env.NODE_ENV === 'production';

  res.cookie(sessionCookieName, session.id, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    expires: session.expiresAt,
    path: '/',
  });
  res.cookie(csrfCookieName, session.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    expires: session.expiresAt,
    path: '/',
  });
}

export function clearSessionCookies(
  res: Response,
  options: { sessionCookieName?: string; csrfCookieName?: string } = {},
): void {
  const sessionCookieName = options.sessionCookieName ?? 'open42_session';
  const csrfCookieName = options.csrfCookieName ?? 'open42_csrf';
  const secure = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    expires: new Date(0),
    path: '/',
  };

  res.cookie(sessionCookieName, '', cookieOptions);
  res.cookie(csrfCookieName, '', {
    ...cookieOptions,
    httpOnly: false,
  });
}
