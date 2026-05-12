/**
 * Dev-only: re-run gbrain tenant provisioning for a user that's stuck in
 * status='provisioning'. Useful when the original async provision call
 * (POST /workspaces/onboarding/workspace) silently failed at signup.
 *
 * Usage:
 *   tsx apps/api/scripts/dev-provision-tenant.ts <email-or-user-id>
 *
 * NOT mounted in production — relies on TENANT_PROVISIONER=local-docker (default
 * for dev) and the docker daemon being available.
 */
import '../src/env.js';
import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '../src/db/client.js';
import { generateProxyToken } from '../src/proxy/token.js';
import { provisionTenant } from '../src/tenants/provision.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: dev-provision-tenant.ts <email-or-user-id>');
    process.exit(2);
  }

  const userId = await resolveUserId(arg);
  if (!userId) {
    console.error(`no user found for ${arg}`);
    process.exit(1);
  }

  // provisionTenant is now keyed by workspaceId end-to-end (Chunk-7 round-3
  // P1). For this dev script we operate on the owner's first non-deleted
  // workspace via memberships; if none exists, ensureWorkspaceForProvisioning
  // will create one on demand.
  const workspaceId = await resolveOwnerWorkspaceId(userId);
  if (!workspaceId) {
    console.error(`no workspace found for user ${userId}; create one via the app first`);
    process.exit(1);
  }

  console.log(`[provision] user=${userId} workspace=${workspaceId} starting…`);
  const result = await provisionTenant({ workspaceId, ownerUserId: userId });
  await ensureWorkspaceProxyToken(result.workspaceId);
  console.log('[provision] done');
  console.log(JSON.stringify(result, null, 2));
}

async function resolveOwnerWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: schema.memberships.workspaceId })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.role, 'owner'),
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .limit(1);
  return row?.workspaceId ?? null;
}

async function resolveUserId(arg: string): Promise<string | null> {
  const looksLikeUuid = /^[0-9a-f-]{36}$/i.test(arg);
  if (looksLikeUuid) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, arg))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, arg.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function ensureWorkspaceProxyToken(workspaceId: string): Promise<void> {
  const [workspace] = await db
    .select({
      id: schema.workspaces.id,
      proxyTokenHash: schema.workspaces.proxyTokenHash,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace || workspace.proxyTokenHash) return;

  const { token, hash } = generateProxyToken(workspace.id);
  await db
    .update(schema.workspaces)
    .set({ proxyTokenHash: hash })
    .where(eq(schema.workspaces.id, workspace.id));

  const apiBaseUrl = localOpen42ApiBaseUrl();
  console.log('[proxy] workspace had no proxy_token_hash; generated one');
  console.log('[proxy] restart the tenant container with these environment variables:');
  console.log(`  OPENAI_API_KEY=${token}`);
  console.log(`  OPENAI_BASE_URL=${apiBaseUrl}/proxy/openai/v1`);
  console.log(`  ANTHROPIC_API_KEY=${token}`);
  console.log(`  ANTHROPIC_BASE_URL=${apiBaseUrl}/proxy/anthropic`);
}

function localOpen42ApiBaseUrl(): string {
  const port = process.env.API_PORT ?? '3001';
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return `http://host.docker.internal:${port}`;
  }
  if (process.platform === 'linux') {
    return `http://172.17.0.1:${port}`;
  }
  console.warn(
    `[proxy] undetected platform ${process.platform}; falling back to host.docker.internal`,
  );
  return `http://host.docker.internal:${port}`;
}

main()
  .catch((err) => {
    console.error('[provision] failed', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
