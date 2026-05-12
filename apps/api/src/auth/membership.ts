/**
 * Single source of truth for "session userId → authorized workspaceId".
 *
 * Why this file exists (Codex ship-blocker #1):
 *   `users.currentWorkspaceId` is a UI hint. It is writable through normal
 *   CRUD paths and could be wrong (bug, future API surface that takes
 *   workspace_id from input, ...). If a route resolves the workspace by
 *   reading `users.currentWorkspaceId` and looking it up directly, a corrupt
 *   value grants the user cross-tenant access to another workspace's gbrain.
 *
 *   This module replaces the unsafe path with two helpers that JOIN through
 *   the `memberships` table — the only legitimate authorization claim — and
 *   exclude soft-deleted workspaces. Use these helpers everywhere a route
 *   needs to know "which workspace can this user touch".
 *
 *   Never trust `users.currentWorkspaceId` for authorization.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { db, schema } from '../db/client.js';

export type MembershipRole = 'owner' | 'admin' | 'member';

/**
 * Returns one workspace owned by this user, or null if they own none.
 *
 * In v1 of the Slack-style multi-workspace model, users may own multiple
 * workspaces. This helper does NOT enumerate them — it returns at most one
 * (LIMIT 1, undefined ordering). Callers that need the full owned set must
 * query `memberships` directly (`WHERE user_id = $1 AND role = 'owner'`).
 *
 * Used today only by code paths that need "do they own any?" (a yes/no
 * question), not "which ones?". If a new caller appears that needs a
 * deterministic single owner, this function should be renamed or replaced.
 *
 * The lookup goes through `memberships` (role='owner') joined to `workspaces`
 * (deleted_at IS NULL) so a corrupt `users.currentWorkspaceId` cannot grant access.
 */
export async function resolveOwnerWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: schema.memberships.workspaceId })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.role, 'owner'),
        isNull(schema.workspaces.deletedAt),
      ),
    )
    .limit(1);
  return row?.workspaceId ?? null;
}

/**
 * Returns whether a workspace's runtime is fully provisioned and usable —
 * i.e. status='ready' AND the gbrain credentials needed to talk to the
 * tenant runtime are populated. Use this before any action that depends
 * on the per-tenant gbrain (creating connections, kicking ingest, etc.)
 * so the action fails fast instead of being queued against a runtime
 * that isn't there yet.
 *
 * Returns null when the workspace doesn't exist or is soft-deleted. The
 * shape mirrors the readiness derivation in workspaces/provision.ts so
 * the same definition of "ready" is enforced across the API.
 */
export async function getWorkspaceReadiness(
  workspaceId: string,
): Promise<{ status: string; gbrainReady: boolean } | null> {
  const [row] = await db
    .select({
      status: schema.workspaces.status,
      gbrainBaseUrl: schema.workspaces.gbrainBaseUrl,
      gbrainPrivateAddress: schema.workspaces.gbrainPrivateAddress,
      gbrainOauthClientId: schema.workspaces.gbrainOauthClientId,
      gbrainOauthClientSecretCiphertext:
        schema.workspaces.gbrainOauthClientSecretCiphertext,
    })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, workspaceId),
        isNull(schema.workspaces.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const gbrainReady = Boolean(
    (row.gbrainBaseUrl || row.gbrainPrivateAddress) &&
      row.gbrainOauthClientId &&
      row.gbrainOauthClientSecretCiphertext,
  );
  return { status: row.status, gbrainReady };
}

/**
 * Asserts the user has a membership row for the given workspaceId on a
 * non-deleted workspace. Returns the role on success; throws an Error with
 * message `'workspace_membership_required'`, `status: 403`, and
 * `code: 'workspace_membership_required'` otherwise.
 *
 * Use this when the workspaceId arrives from a route param (or any
 * non-trusted source). The membership table is the only authorization claim
 * — never use `users.currentWorkspaceId` to gate access.
 */
export async function assertWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<{ role: MembershipRole }> {
  const [row] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.workspaceId, workspaceId),
        isNull(schema.workspaces.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    const err = new Error('workspace_membership_required') as Error & {
      status?: number;
      code?: string;
    };
    err.status = 403;
    err.code = 'workspace_membership_required';
    throw err;
  }
  return { role: row.role };
}

/**
 * Roles permitted to invite new members to a workspace. Members may not invite.
 */
const INVITE_ROLES: ReadonlySet<MembershipRole> = new Set(['owner', 'admin']);

/**
 * Roles permitted to manage (add/remove/role-change) existing members.
 */
const MANAGE_ROLES: ReadonlySet<MembershipRole> = new Set(['owner', 'admin']);

/**
 * Asserts the user has membership in the workspace AND has a role permitted
 * to invite new members. Returns the role on success.
 *
 * Throws an Error with `status: 403` and `code: 'forbidden_cannot_invite'`
 * when the user is a member but lacks the role; propagates the underlying
 * `assertWorkspaceMembership` error when there is no membership at all.
 */
export async function assertCanInvite(
  userId: string,
  workspaceId: string,
): Promise<{ role: MembershipRole }> {
  const { role } = await assertWorkspaceMembership(userId, workspaceId);
  if (!INVITE_ROLES.has(role)) {
    const err = new Error('forbidden_cannot_invite') as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = 'forbidden_cannot_invite';
    throw err;
  }
  return { role };
}

/**
 * Asserts the user has membership in the workspace AND has a role permitted
 * to manage members (add/remove/role changes). Returns the role on success.
 *
 * Throws an Error with `status: 403` and `code: 'forbidden_cannot_manage_members'`
 * when the user is a member but lacks the role; propagates the underlying
 * `assertWorkspaceMembership` error when there is no membership at all.
 */
export async function assertCanManageMembers(
  userId: string,
  workspaceId: string,
): Promise<{ role: MembershipRole }> {
  const { role } = await assertWorkspaceMembership(userId, workspaceId);
  if (!MANAGE_ROLES.has(role)) {
    const err = new Error('forbidden_cannot_manage_members') as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = 'forbidden_cannot_manage_members';
    throw err;
  }
  return { role };
}
