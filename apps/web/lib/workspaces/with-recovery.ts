import Router from 'next/router';

import { useWorkspaceStore } from './store';

export type RecoveryOutcome =
  | { kind: 'switched'; workspaceId: string }
  | { kind: 'no_workspaces' };

/**
 * Tenant-scoped 403 recovery flow (spec D7).
 *
 * Refreshes the membership list, switches to the first remaining workspace,
 * and routes the user back to `/` — or to `/auth/onboard` when no workspaces
 * remain. Returns the recovery outcome so callers can layer extra UI work on
 * top (e.g. a toast) without re-implementing the routing decision.
 *
 * This is the single source of truth for "what happens when a tenant-scoped
 * fetch returns 403". Both `withRecovery` (the JSON-fetch wrapper used by
 * members) and the imperative 403 branches in dashboard + chat call this.
 */
export async function recoverFromTenant403(): Promise<RecoveryOutcome> {
  const outcome = await useWorkspaceStore.getState().recoverFromForbidden();
  if (outcome.kind === 'no_workspaces') {
    void Router.replace('/auth/onboard');
  } else {
    void Router.replace('/');
  }
  return outcome;
}

/**
 * Higher-order helper for tenant-scoped fetches.
 *
 * Wraps a fetch invocation so that:
 *   - 2xx responses are parsed and returned to the caller.
 *   - 403 responses run the workspace recovery flow (per spec D7). Returns
 *     `null` so callers can skip the "render the data" branch.
 *   - Any other non-OK response throws a tagged Error the caller surfaces.
 */
export async function withRecovery<T>(
  doFetch: () => Promise<Response>,
): Promise<T | null> {
  const res = await doFetch();
  if (res.ok) {
    return (await res.json()) as T;
  }
  if (res.status === 403) {
    await recoverFromTenant403();
    return null;
  }
  throw Object.assign(new Error('fetch_failed'), { status: res.status });
}
