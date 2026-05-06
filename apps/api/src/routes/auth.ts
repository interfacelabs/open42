import { Router } from 'express';

import { createSession, invalidateSession } from '../auth/sessions.js';
import {
  sendSupabaseMagicLink,
  verifySupabaseIdentity,
  type SupabaseIdentity,
} from '../auth/supabase.js';
import { db, schema } from '../db/client.js';
import { clearSessionCookies, setSessionCookies } from '../middleware/csrf.js';
import { provisionTenant } from '../tenants/provision.js';

export const authRouter = Router();

authRouter.post('/signin', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '');
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
    const provisioned = await ensureWorkspace(user.id, user.currentWorkspaceId);
    if (!provisioned) {
      res.status(503).json({ error: 'workspace_provision_failed' });
      return;
    }

    const session = await createSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    setSessionCookies(res, session);
    res.json({ ok: true, redirectTo: '/auth/home' });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('supabase_')) {
      res.status(400).json({ error: err.message });
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
  const [user] = await db
    .insert(schema.users)
    .values({
      email: identity.email,
      supabaseUserId: identity.supabaseUserId,
    })
    .onConflictDoUpdate({
      target: schema.users.supabaseUserId,
      set: { email: identity.email },
    })
    .returning();
  if (!user) throw new Error('user_upsert_failed');
  return user;
}

async function ensureWorkspace(userId: string, currentWorkspaceId: string | null): Promise<boolean> {
  if (currentWorkspaceId) return true;

  try {
    await provisionTenant({ ownerUserId: userId });
    return true;
  } catch (err) {
    console.error('tenant provisioning failed', err);
    return false;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
