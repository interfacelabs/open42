import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { createMagicLink, consumeMagicLink } from '../auth/magic-link.js';
import { createSession } from '../auth/sessions.js';
import { db, schema } from '../db/client.js';
import { setSessionCookies } from '../middleware/csrf.js';
import { provisionTenant } from '../tenants/provision.js';

export const authRouter = Router();

authRouter.post('/signup', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '');
    const link = await createMagicLink(email);
    const webUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    res.json({
      ok: true,
      delivery: 'debug',
      magicLinkUrl: `${webUrl.replace(/\/+$/, '')}/auth/verify?token=${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'email_invalid') {
      res.status(400).json({ error: 'email_invalid' });
      return;
    }
    next(err);
  }
});

authRouter.post('/verify', async (req, res, next) => {
  try {
    const token = String(req.body?.token ?? '');
    const magicLink = await consumeMagicLink(token);
    const user = await upsertUser(magicLink.email);
    await ensureWorkspace(user.id, user.currentWorkspaceId);

    const session = await createSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    setSessionCookies(res, session);
    res.json({ ok: true, redirectTo: '/home' });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('magic_link_')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

async function upsertUser(email: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ email })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { email },
    })
    .returning();
  if (!user) throw new Error('user_upsert_failed');
  return user;
}

async function ensureWorkspace(userId: string, currentWorkspaceId: string | null) {
  if (currentWorkspaceId) return;

  if (hasFlyProvisioningConfig()) {
    try {
      await provisionTenant({ ownerUserId: userId });
      return;
    } catch {
      // Fall through to a structured provisioning placeholder. The UI can show
      // this state instead of making signup fail because cloud credentials are
      // unavailable in local development.
    }
  }

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      ownerUserId: userId,
      gbrainVersion: process.env.GBRAIN_VERSION ?? '0.27.1',
      status: 'provisioning',
    })
    .returning({ id: schema.workspaces.id });
  if (!workspace) throw new Error('workspace_insert_failed');

  await db
    .update(schema.users)
    .set({ currentWorkspaceId: workspace.id })
    .where(eq(schema.users.id, userId));
  await db.insert(schema.memberships).values({
    userId,
    workspaceId: workspace.id,
    role: 'owner',
  });
}

function hasFlyProvisioningConfig(): boolean {
  return Boolean(
    process.env.FLY_API_TOKEN &&
      process.env.FLY_API_TOKEN !== 'fo_...' &&
      process.env.FLY_TENANTS_APP_NAME,
  );
}
