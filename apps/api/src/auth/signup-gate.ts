import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '../db/client.js';

export const SIGNIN_NOT_ALLOWED_ERROR = 'signin_not_allowed';
export const OWNER_SIGNUP_NOT_ALLOWED_ERROR = 'owner_signup_not_allowed';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeSigninEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('email_invalid');
  }
  return normalized;
}

export function isOwnerSignupAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = normalizeSigninEmail(email);
  if (env.OPEN42_EDITION !== 'cloud') return true;
  if (isOpenSignupEnabled(env)) return true;

  const allowedEmails = csv(env.OPEN42_ALLOWED_EMAILS).map((value) => value.toLowerCase());
  const allowedDomains = csv(env.OPEN42_ALLOWED_EMAIL_DOMAINS).map((value) =>
    value.replace(/^@/, '').toLowerCase(),
  );

  if (
    env.NODE_ENV !== 'production' &&
    env.OPEN42_ENABLE_OPEN_SIGNUPS !== 'false' &&
    allowedEmails.length === 0 &&
    allowedDomains.length === 0
  ) {
    return true;
  }

  if (allowedEmails.includes(normalized)) return true;

  const domain = normalized.split('@')[1] ?? '';
  return Boolean(domain && allowedDomains.includes(domain));
}

export function assertOwnerSignupAllowed(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isOwnerSignupAllowed(email, env)) {
    throw new Error(OWNER_SIGNUP_NOT_ALLOWED_ERROR);
  }
}

export async function assertSigninAllowed(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const normalized = normalizeSigninEmail(email);
  if (isOwnerSignupAllowed(normalized, env)) return;
  if (await hasAcceptedWorkspaceMembership(normalized)) return;
  if (await hasPendingWorkspaceInvite(normalized)) return;
  throw new Error(SIGNIN_NOT_ALLOWED_ERROR);
}

async function hasAcceptedWorkspaceMembership(email: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(
      and(
        sql`lower(${schema.users.email}) = ${email}`,
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function hasPendingWorkspaceInvite(email: string): Promise<boolean> {
  const minCreatedAt = new Date(Date.now() - INVITE_TTL_MS);
  const [row] = await db
    .select({ inviteId: schema.workspaceInvites.id })
    .from(schema.workspaceInvites)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceInvites.workspaceId))
    .where(
      and(
        sql`lower(${schema.workspaceInvites.email}) = ${email}`,
        eq(schema.workspaceInvites.status, 'pending'),
        sql`${schema.workspaceInvites.createdAt} > ${minCreatedAt}`,
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

function isOpenSignupEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env.OPEN42_ENABLE_OPEN_SIGNUPS ?? '').toLowerCase());
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
