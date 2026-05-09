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

export type MembershipRole = 'owner' | 'member';

/**
 * Returns the workspace this user OWNS, or null if they own none.
 *
 * P1 invariant: every user owns at most one workspace
 * (workspaces_owner_user_id_uniq). The lookup goes through `memberships`
 * (role='owner') joined to `workspaces` (deleted_at IS NULL) so a corrupt
 * `users.currentWorkspaceId` cannot grant access.
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
 * Asserts the user has a membership row for the given workspaceId on a
 * non-deleted workspace. Returns the role on success; throws an Error with
 * message `'workspace_membership_required'` otherwise.
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
  if (!row) throw new Error('workspace_membership_required');
  return { role: row.role };
}
