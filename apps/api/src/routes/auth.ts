import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { createSession, invalidateSession } from '../auth/sessions.js';
import { readSession } from '../auth/session-helpers.js';
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
const SIGNIN_MIN_GAP_MS = 30 * 1000;
const signinAttempts = new Map<
  string,
  { count: number; resetAt: number; lastAttemptAt: number }
>();

export function __resetSigninAttempts(): void {
  signinAttempts.clear();
}

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
      const retryAfter = (err as Error & { retryAfter?: number }).retryAfter ?? 30;
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'signin_rate_limited', retryAfter });
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
  const inviteId = optionalString(req.body?.inviteId);
  try {
    const identity = await verifySupabaseIdentity({
      accessToken: optionalString(req.body?.accessToken),
      tokenHash: optionalString(req.body?.tokenHash),
      type: optionalString(req.body?.type),
      email: optionalString(req.body?.email),
      token: optionalString(req.body?.token),
    });
    if (!inviteId) {
      assertSigninAllowed(identity.email);
    }
    const user = await upsertUser(identity);

    if (inviteId) {
      const [invite] = await db
        .select()
        .from(schema.workspaceInvites)
        .where(eq(schema.workspaceInvites.id, inviteId))
        .limit(1);
      if (!invite) {
        res.status(400).json({ error: 'invite_not_found' });
        return;
      }
      if (invite.email.toLowerCase() !== identity.email.toLowerCase()) {
        res.status(400).json({ error: 'invite_email_mismatch' });
        return;
      }
      if (invite.status === 'revoked') {
        res.status(410).json({ error: 'invite_revoked' });
        return;
      }
      if (invite.status === 'pending') {
        // Codex round-4 P2: enforce the same 24h server-side TTL as the
        // signed-in fast path (Path B in apps/api/src/routes/workspaces/accept.ts,
        // INVITE_TTL_MS = 24 * 60 * 60 * 1000). Pre-fix this branch accepted
        // any pending invite regardless of age, while Path B already rejected
        // older invites — the two paths could diverge for the same invite
        // depending on whether the user happened to be signed in.
        // Value inlined; canonical constant lives in accept.ts.
        const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - invite.createdAt.getTime() > INVITE_TTL_MS) {
          res.status(400).json({ error: 'invite_expired' });
          return;
        }
        // B2 multi-workspace: invite acceptance no longer gated on whether
        // the caller already owns another workspace. A user may be owner of
        // one workspace AND member of another, simultaneously. The previous
        // `invite_blocked` short-circuit was removed when B2 landed.
        //
        // Codex round-8 P2: re-read the invite with `FOR UPDATE` inside the
        // transaction and verify `status='pending'` before inserting the
        // membership. Round-7 made the revoke side a no-op when accept won
        // (`SET status='revoked' WHERE status='pending'`), but the inverse
        // race — revoke commits between the outer pre-tx read and the
        // transaction body — would still let us overwrite a revoked invite
        // back to accepted AND grant a membership for it. Path B already
        // does this in apps/api/src/routes/workspaces/accept.ts; this brings
        // Path A to parity.
        //
        // The transaction sets `txOutcome` to communicate the result back
        // to the outer handler. We surface a racy-revoked invite as 410
        // invite_revoked (same code as the pre-tx revoked check above) and
        // a racy-expired invite as 400 invite_expired (matching the pre-tx
        // expiry check). 'already_accepted' is treated as a benign success
        // — the membership / current_workspace_id work has been done by the
        // winning concurrent accept; we still hand the user a session and
        // redirect them to '/'.
        // Holder wraps the outcome so TypeScript's control-flow analysis
        // can't narrow `outcome` to its initial 'accepted' literal — the
        // value is reassigned inside the transaction callback, and the
        // narrowed type would otherwise reject the subsequent comparisons.
        type TxOutcome = 'accepted' | 'revoked' | 'expired' | 'already_accepted';
        const txState: { outcome: TxOutcome } = { outcome: 'accepted' };
        await db.transaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(schema.workspaceInvites)
            .where(eq(schema.workspaceInvites.id, invite.id))
            .for('update')
            .limit(1);
          if (!locked) {
            // Extremely unlikely: invite was deleted between the outer read
            // and the inner lock. Treat as revoked for the user-facing
            // error, since it's the closest semantically.
            txState.outcome = 'revoked';
            return;
          }
          if (locked.status === 'revoked') {
            txState.outcome = 'revoked';
            return;
          }
          if (locked.status === 'accepted') {
            // Another concurrent accept won. The membership row is already
            // there (by the winning tx); we just need to keep the UX
            // consistent and update current_workspace_id so the user lands
            // on the workspace they joined. Membership insert is skipped to
            // avoid touching a row owned by the winning tx's invariants.
            txState.outcome = 'already_accepted';
            await tx
              .update(schema.users)
              .set({ currentWorkspaceId: locked.workspaceId })
              .where(eq(schema.users.id, user.id));
            return;
          }
          // Re-check expiry against the locked row. createdAt can't change
          // (it's immutable in our schema), but reading it from `locked`
          // keeps the check syntactically beside the lock so a future
          // schema change that DOES mutate createdAt can't drift the
          // semantics.
          if (Date.now() - locked.createdAt.getTime() > INVITE_TTL_MS) {
            txState.outcome = 'expired';
            return;
          }
          // ON CONFLICT DO NOTHING guards against the rare race where the
          // user already has a membership row for this workspace (e.g. an
          // admin manually added them mid-flight, or two parallel invite
          // accepts). PK is (user_id, workspace_id), so a duplicate would
          // otherwise throw and return 500.
          await tx
            .insert(schema.memberships)
            .values({
              workspaceId: locked.workspaceId,
              userId: user.id,
              role: locked.role,
            })
            .onConflictDoNothing();
          await tx
            .update(schema.workspaceInvites)
            .set({ status: 'accepted' })
            .where(eq(schema.workspaceInvites.id, locked.id));
          // Codex round-2 P2: Path A (signed-out invite accept) must update
          // users.current_workspace_id, matching the signed-in fast-path in
          // apps/api/src/routes/workspaces/accept.ts. Without this update,
          // the user lands on `/` pointed at whatever workspace
          // currentWorkspaceForUser happens to pick — not the one they just
          // accepted the invite for. UI hint only; never gates authorization.
          await tx
            .update(schema.users)
            .set({ currentWorkspaceId: locked.workspaceId })
            .where(eq(schema.users.id, user.id));
        });
        if (txState.outcome === 'revoked') {
          res.status(410).json({ error: 'invite_revoked' });
          return;
        }
        if (txState.outcome === 'expired') {
          res.status(400).json({ error: 'invite_expired' });
          return;
        }
        // 'accepted' and 'already_accepted' both fall through to the
        // session-issuing happy path below.
      }
    }

    const session = await createSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    setSessionCookies(res, session);
    res.json({
      ok: true,
      redirectTo: inviteId ? '/' : '/onboard',
    });
  } catch (err) {
    if (inviteId && err instanceof Error && isOtpExpiredError(err)) {
      res.status(400).json({ error: 'invite_expired' });
      return;
    }
    if (err instanceof Error && err.message.startsWith('supabase_')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message === 'signin_not_allowed') {
      res.status(403).json({ error: 'signin_not_allowed' });
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

authRouter.get('/me', async (req, res, next) => {
  try {
    const session = await readSession(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email, currentWorkspaceId: schema.users.currentWorkspaceId })
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ id: user.id, email: user.email, currentWorkspaceId: user.currentWorkspaceId ?? null });
  } catch (err) { next(err); }
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

function isOtpExpiredError(err: Error): boolean {
  // Supabase errors flow through verifySupabaseIdentity wrapped as
  // `supabase_verify_failed:otp_expired`; the test harness uses the bare
  // `supabase_otp_expired` form. Accept both.
  return /otp_expired/i.test(err.message);
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

function assertSigninRateLimit(ip: string | undefined, email: string): void {
  const key = `${normalizeSigninEmail(email)}:${ip ?? 'unknown'}`;
  const now = Date.now();
  const entry = signinAttempts.get(key);
  if (entry && now < entry.resetAt) {
    if (now - entry.lastAttemptAt < SIGNIN_MIN_GAP_MS) {
      const err = new Error('signin_rate_limited') as Error & { retryAfter?: number };
      err.retryAfter = Math.ceil((SIGNIN_MIN_GAP_MS - (now - entry.lastAttemptAt)) / 1000);
      throw err;
    }
    if (entry.count >= SIGNIN_LIMIT) {
      const err = new Error('signin_rate_limited') as Error & { retryAfter?: number };
      err.retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw err;
    }
    entry.count += 1;
    entry.lastAttemptAt = now;
  } else {
    signinAttempts.set(key, { count: 1, resetAt: now + SIGNIN_WINDOW_MS, lastAttemptAt: now });
  }
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
