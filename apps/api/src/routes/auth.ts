import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { createSession, invalidateSession } from '../auth/sessions.js';
import {
  sendSupabaseMagicLink,
  verifySupabaseIdentity,
  type SupabaseIdentity,
} from '../auth/supabase.js';
import { db, schema } from '../db/client.js';
import { clearSessionCookies, setSessionCookies } from '../middleware/csrf.js';

export const authRouter = Router();

const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_LIMIT = 5;
const signinAttempts = new Map<string, { count: number; resetAt: number }>();

authRouter.post('/signin', async (req, res, next) => {
  try {
    const email = normalizeSigninEmail(String(req.body?.email ?? ''));
    assertSigninRateLimit(req.ip, email);
    assertSigninAllowed(email);
    const webUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    const link = await sendSupabaseMagicLink({
      email,
      redirectTo: `${webUrl.replace(/\/+$/, '')}/sign_in`,
    });
    res.json({
      ok: true,
      delivery: 'supabase_email',
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'email_invalid') {
      res.status(400).json({ error: 'email_invalid' });
      return;
    }
    if (err instanceof Error && err.message === 'signin_not_allowed') {
      res.status(403).json({ error: 'signin_not_allowed' });
      return;
    }
    if (err instanceof Error && err.message === 'signin_rate_limited') {
      res.status(429).json({ error: 'signin_rate_limited' });
      return;
    }
    if (err instanceof Error && err.message.includes('SUPABASE_')) {
      res.status(503).json({ error: 'supabase_not_configured', message: err.message });
      return;
    }
    if (err instanceof Error && err.message.startsWith('supabase_')) {
      res.status(502).json({ error: err.message });
      return;
    }
    next(err);
  }
});

authRouter.post('/verify', async (req, res, next) => {
  try {
    const identity = await verifySupabaseIdentity({
      accessToken: optionalString(req.body?.accessToken),
      tokenHash: optionalString(req.body?.tokenHash),
      type: optionalString(req.body?.type),
      email: optionalString(req.body?.email),
      token: optionalString(req.body?.token),
    });
    const user = await upsertUser(identity);

    const session = await createSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    setSessionCookies(res, session);
    res.json({
      ok: true,
      redirectTo: '/auth/onboard',
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('supabase_')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message === 'email_already_linked') {
      res.status(409).json({ error: 'email_already_linked' });
      return;
    }
    next(err);
  }
});

authRouter.post('/signout', async (req, res, next) => {
  try {
    const sessionId = optionalString(
      req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'],
    );
    if (sessionId) {
      await invalidateSession(sessionId);
    }
    clearSessionCookies(res);
    res.json({ ok: true, redirectTo: '/sign_in' });
  } catch (err) {
    next(err);
  }
});

async function upsertUser(identity: SupabaseIdentity) {
  return db.transaction(async (tx) => {
    const [bySupabaseId] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.supabaseUserId, identity.supabaseUserId))
      .limit(1);

    if (bySupabaseId) {
      if (bySupabaseId.email === identity.email) return bySupabaseId;
      const [emailOwner] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, identity.email))
        .limit(1);
      if (emailOwner && emailOwner.id !== bySupabaseId.id) {
        throw new Error('email_already_linked');
      }
      const [updated] = await tx
        .update(schema.users)
        .set({ email: identity.email })
        .where(eq(schema.users.id, bySupabaseId.id))
        .returning();
      if (!updated) throw new Error('user_upsert_failed');
      return updated;
    }

    const [byEmail] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, identity.email))
      .limit(1);

    if (byEmail) {
      if (byEmail.supabaseUserId && byEmail.supabaseUserId !== identity.supabaseUserId) {
        throw new Error('email_already_linked');
      }
      const [updated] = await tx
        .update(schema.users)
        .set({ supabaseUserId: identity.supabaseUserId })
        .where(eq(schema.users.id, byEmail.id))
        .returning();
      if (!updated) throw new Error('user_upsert_failed');
      return updated;
    }

    const [user] = await tx
      .insert(schema.users)
      .values({
        email: identity.email,
        supabaseUserId: identity.supabaseUserId,
      })
      .returning();
    if (!user) throw new Error('user_upsert_failed');
    return user;
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function assertSigninAllowed(email: string, env = process.env): void {
  const normalized = normalizeSigninEmail(email);
  const allowedEmails = csv(env.OPEN42_ALLOWED_EMAILS).map((value) => value.toLowerCase());
  const allowedDomains = csv(env.OPEN42_ALLOWED_EMAIL_DOMAINS).map((value) =>
    value.replace(/^@/, '').toLowerCase(),
  );
  const openSignups =
    env.OPEN42_ENABLE_OPEN_SIGNUPS === 'true' ||
    (env.NODE_ENV !== 'production' && allowedEmails.length === 0 && allowedDomains.length === 0);
  if (openSignups) return;
  if (allowedEmails.includes(normalized)) return;

  const domain = normalized.split('@')[1] ?? '';
  if (domain && allowedDomains.includes(domain)) return;
  throw new Error('signin_not_allowed');
}

function assertSigninRateLimit(ip: string | undefined, email: string, now = Date.now()): void {
  hitSigninBucket(`ip:${ip ?? 'unknown'}`, now);
  hitSigninBucket(`email:${normalizeSigninEmail(email)}`, now);
}

function hitSigninBucket(key: string, now: number): void {
  const current = signinAttempts.get(key);
  if (!current || current.resetAt <= now) {
    signinAttempts.set(key, { count: 1, resetAt: now + SIGNIN_WINDOW_MS });
    return;
  }
  if (current.count >= SIGNIN_LIMIT) {
    throw new Error('signin_rate_limited');
  }
  signinAttempts.set(key, { ...current, count: current.count + 1 });
}

function normalizeSigninEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('email_invalid');
  }
  return normalized;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
