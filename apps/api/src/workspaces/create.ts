/**
 * Shared "create a workspace owned by user" primitive.
 *
 * Two routes call this:
 *   - POST /workspaces                       (top-level CRUD; the new in-app
 *                                             "create another workspace" entry
 *                                             point added in chunk 5)
 *   - POST /workspaces/onboarding/workspace  (legacy onboarding handler that
 *                                             also doubles as "name the
 *                                             first workspace")
 *
 * Both want the same invariants:
 *   1. INSERT into `workspaces` with status='provisioning'.
 *   2. INSERT into `memberships` with role='owner' (membership is the only
 *      authorization claim — see apps/api/src/auth/membership.ts).
 *   3. Best-effort set `users.current_workspace_id` IF the user has none
 *      (the UI hint; never trusted for authorization).
 *   4. Enqueue a tenant-provisioning job into BullMQ.
 *
 * The transaction wraps steps 1–3 so a partial workspace (no owner
 * membership) is impossible. Step 4 happens after the transaction commits —
 * enqueuing inside a transaction would race with the worker picking it up
 * before the workspace row is visible.
 */
import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '../db/client.js';
import { OPEN42_ALLOW_MULTI_WORKSPACE, OPEN42_SINGLE_WORKSPACE_ID } from '../env.js';
import { enqueueProvisionJob as defaultEnqueueProvisionJob } from '../queue/provision-queue.js';

export interface CreateWorkspaceResult {
  id: string;
  name: string;
  status: 'provisioning' | 'ready' | 'failed';
}

export interface CreateWorkspaceDeps {
  enqueueProvisionJob?: typeof defaultEnqueueProvisionJob;
  /**
   * Skip queue enqueue entirely. Used by callers that want to drive
   * provisioning inline (legacy tests inject a synchronous
   * `safelyProvisionTenant`).
   */
  skipEnqueue?: boolean;
}

export async function createWorkspaceForUser(
  ownerUserId: string,
  name: string,
  deps: CreateWorkspaceDeps = {},
): Promise<CreateWorkspaceResult> {
  const enqueue = deps.enqueueProvisionJob ?? defaultEnqueueProvisionJob;

  const workspace = await db.transaction(async (tx) => {
    const [countRow] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.workspaces)
      .where(sql`${schema.workspaces.deletedAt} IS NULL`);
    const workspaceCount = Number(countRow?.count ?? 0);
    const fixedWorkspaceId =
      !OPEN42_ALLOW_MULTI_WORKSPACE && workspaceCount === 0 && OPEN42_SINGLE_WORKSPACE_ID
        ? OPEN42_SINGLE_WORKSPACE_ID
        : undefined;
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({
        id: fixedWorkspaceId,
        name,
        ownerUserId,
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: 'provisioning',
      })
      .returning({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        status: schema.workspaces.status,
      });
    if (!ws) throw new Error('workspace_insert_failed');

    await tx
      .insert(schema.memberships)
      .values({ userId: ownerUserId, workspaceId: ws.id, role: 'owner' })
      .onConflictDoNothing();

    // Best-effort: set users.current_workspace_id when the user has none.
    // This is purely the UI hint — it does not gate authorization, so the
    // single-statement guard (only update when currently NULL) avoids
    // stomping on a user who is actively working in a different workspace.
    await tx
      .update(schema.users)
      .set({ currentWorkspaceId: ws.id })
      .where(
        and(eq(schema.users.id, ownerUserId), sql`${schema.users.currentWorkspaceId} IS NULL`),
      );

    return ws;
  });

  if (!deps.skipEnqueue) {
    await enqueue({
      workspaceId: workspace.id,
      ownerUserId,
    });
  }

  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status as 'provisioning' | 'ready' | 'failed',
  };
}
