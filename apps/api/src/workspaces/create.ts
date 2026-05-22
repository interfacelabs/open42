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
 *   1. INSERT into `workspaces` with the chosen plan. Free workspaces enter
 *      status='provisioning'; paid workspaces enter status='billing_required'
 *      and wait for Stripe before any tenant job is queued.
 *   2. INSERT into `memberships` with role='owner' (membership is the only
 *      authorization claim — see apps/api/src/auth/membership.ts).
 *   3. Best-effort set `users.current_workspace_id` IF the user has none
 *      (the UI hint; never trusted for authorization).
 *   4. Enqueue a tenant-provisioning job into BullMQ only when billing is not
 *      required.
 *
 * The plan is captured before enqueue so the hybrid provisioner can route
 * starter/free workspaces to the free pool and paid workspaces to private Fly
 * after the paid gate has cleared.
 *
 * The transaction wraps steps 1–3 so a partial workspace (no owner
 * membership) is impossible. Step 4 happens after the transaction commits —
 * enqueuing inside a transaction would race with the worker picking it up
 * before the workspace row is visible.
 */
import { and, eq, sql } from 'drizzle-orm';

import { assertOwnerSignupAllowed } from '../auth/signup-gate.js';
import { db, schema } from '../db/client.js';
import { OPEN42_ALLOW_MULTI_WORKSPACE, OPEN42_SINGLE_WORKSPACE_ID } from '../env.js';
import { enqueueProvisionJob as defaultEnqueueProvisionJob } from '../queue/provision-queue.js';
import { workspacePlanRequiresBilling, type WorkspacePlan } from './plan.js';

export interface CreateWorkspaceResult {
  id: string;
  name: string;
  plan: WorkspacePlan | null;
  status: 'billing_required' | 'provisioning' | 'ready' | 'failed';
}

export interface CreateWorkspaceDeps {
  enqueueProvisionJob?: typeof defaultEnqueueProvisionJob;
  env?: NodeJS.ProcessEnv;
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
  plan: WorkspacePlan,
  deps: CreateWorkspaceDeps = {},
): Promise<CreateWorkspaceResult> {
  const enqueue = deps.enqueueProvisionJob ?? defaultEnqueueProvisionJob;
  const requiresBilling = workspacePlanRequiresBilling(plan);

  const workspace = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, ownerUserId))
      .limit(1);
    if (!owner) throw new Error('user_not_found');
    assertOwnerSignupAllowed(owner.email, deps.env);

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
        plan,
        ownerUserId,
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: requiresBilling ? 'billing_required' : 'provisioning',
      })
      .returning({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        plan: schema.workspaces.plan,
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

  if (!deps.skipEnqueue && !requiresBilling) {
    await enqueue({
      workspaceId: workspace.id,
      ownerUserId,
    });
  }

  return {
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    status: workspace.status as 'billing_required' | 'provisioning' | 'ready' | 'failed',
  };
}
