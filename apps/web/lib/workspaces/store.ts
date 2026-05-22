import { useEffect, useRef } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { csrfHeaders } from '@/lib/csrf';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  status: 'billing_required' | 'provisioning' | 'ready' | 'failed';
}

export interface WorkspaceStoreState {
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string | null;
  allowMultiWorkspace: boolean;
  loading: boolean;
  lastError: string | null;
  refresh: () => Promise<void>;
  switchTo: (workspaceId: string) => Promise<void>;
  /**
   * Recovery path when a tenant-scoped fetch returns 403 (the caller has
   * been kicked, or the workspace was deleted). Re-fetches the membership
   * list, then either switches to the first available workspace or signals
   * that the user has none left.
   */
  recoverFromForbidden: () => Promise<
    { kind: 'switched'; workspaceId: string } | { kind: 'no_workspaces' }
  >;
}

export interface StoreDeps {
  /** Inject a fetch impl for tests; defaults to the global. */
  fetch?: typeof fetch;
}

const INITIAL_STATE = {
  workspaces: [],
  currentWorkspaceId: null,
  allowMultiWorkspace: false,
  loading: false,
  lastError: null,
};

export function createWorkspaceStore(
  deps: StoreDeps = {},
): UseBoundStore<StoreApi<WorkspaceStoreState>> {
  // Resolve fetch at call time (not module-load time) so jsdom tests that
  // set `global.fetch` after import still go through the injected mock.
  const f: typeof fetch = deps.fetch
    ? deps.fetch
    : (...args) => (globalThis.fetch as typeof fetch)(...args);
  return create<WorkspaceStoreState>((set, get) => ({
    ...INITIAL_STATE,
    async refresh() {
      set({ loading: true, lastError: null });
      try {
        // Fetch the membership list and the server's current selection in
        // parallel. /api/auth/me already returns users.current_workspace_id
        // (the server-side UI hint that follows invite-accept, switch, etc.),
        // so a fresh page load honors the user's last server-known choice
        // instead of falling back to "first owned" — owner-first hydration
        // surfaced the wrong workspace after invite-accept (codex round-3 P1).
        const [listRes, meRes] = await Promise.all([f('/api/workspaces'), f('/api/auth/me')]);
        if (!listRes.ok) {
          const msg = `workspaces_fetch_failed:${listRes.status}`;
          console.warn('[useWorkspaceStore] refresh non-ok', { status: listRes.status });
          set({ loading: false, lastError: msg });
          return;
        }
        const body = (await listRes.json()) as {
          workspaces: WorkspaceSummary[];
          allowMultiWorkspace?: boolean;
        };
        const me = meRes.ok
          ? ((await meRes.json().catch(() => null)) as {
              currentWorkspaceId?: string | null;
            } | null)
          : null;
        const serverCurrent = me?.currentWorkspaceId ?? null;
        const localCurrent = get().currentWorkspaceId;

        // Resolution order: existing local choice (if still valid, so a
        // mid-session switch isn't clobbered by the next refresh) → server
        // hint (if the user is a member of it) → first listed workspace
        // → null. The server hint lookup uses the freshly-fetched list, so
        // a kicked-from / soft-deleted workspace doesn't sneak through.
        const isMember = (id: string | null) =>
          id !== null && body.workspaces.some((w) => w.id === id);
        let next: string | null;
        if (localCurrent && isMember(localCurrent)) {
          next = localCurrent;
        } else if (serverCurrent && isMember(serverCurrent)) {
          next = serverCurrent;
        } else {
          next = body.workspaces[0]?.id ?? null;
        }

        set({
          workspaces: body.workspaces,
          currentWorkspaceId: next,
          allowMultiWorkspace: Boolean(body.allowMultiWorkspace),
          loading: false,
          lastError: null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown_error';
        console.warn('[useWorkspaceStore] refresh threw', err);
        set({ loading: false, lastError: msg });
      }
    },
    async switchTo(workspaceId) {
      // POST /switch is a state-changing request (mutates users.current_workspace_id)
      // and is gated by CSRF middleware on the API. csrfHeaders() reads the
      // open42_csrf cookie set during sign-in.
      const res = await f(`/api/workspaces/${encodeURIComponent(workspaceId)}/switch`, {
        method: 'POST',
        headers: csrfHeaders(),
      });
      if (!res.ok) throw new Error('switch_failed');
      set({ currentWorkspaceId: workspaceId });
    },
    async recoverFromForbidden() {
      await get().refresh();
      const list = get().workspaces;
      if (list.length === 0) return { kind: 'no_workspaces' as const };
      const target = list[0]!;
      await get().switchTo(target.id);
      return { kind: 'switched' as const, workspaceId: target.id };
    },
  }));
}

export const useWorkspaceStore = createWorkspaceStore();

/**
 * Module-level "which user did we hydrate for?" guard. The Zustand store
 * starts empty (workspaces=[], currentWorkspaceId=null) and nothing on a
 * normal page mount calls refresh(); without this hydrator the
 * WorkspaceSwitcher shows "Select workspace" forever and Settings → Members
 * never knows which workspace to fetch.
 *
 * Why keyed by user id (codex round-7 P2): a boolean `_hydrated` flag
 * survived signout → signin in the same tab, so the new user mounted Sidebar
 * → useHydrateWorkspaceStore short-circuited → the store kept showing the
 * previous user's workspaces until the next 403 triggered recovery. Keying
 * on user id makes re-hydration automatic when the session swaps.
 */
let _hydratedForUserId: string | null = null;

/**
 * Idempotent hydrate hook. Call from the authenticated app chrome (Sidebar).
 * Probes /api/auth/me to find the current user. If the store was hydrated
 * for a different user (or not yet at all), refreshes; otherwise no-op.
 */
export function useHydrateWorkspaceStore(): void {
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void (async () => {
      // Probe /auth/me to find the current user. If hydrated for someone
      // else (signout → signin same tab) OR not hydrated yet, refresh.
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return; // not signed in — leave the store empty.
        const me = (await res.json()) as { id?: string };
        if (!me.id) return;
        if (_hydratedForUserId === me.id) return; // already hydrated for this user
        _hydratedForUserId = me.id;
        await useWorkspaceStore.getState().refresh();
      } catch {
        // Network error — leave the store empty. recoverFromForbidden
        // will catch any subsequent 403 from the tenant-scoped routes.
      }
    })();
  }, []);
}

/** Test-only: reset the module-level singleton between tests. Call in `beforeEach`. */
export function __resetWorkspaceStoreForTests() {
  _hydratedForUserId = null;
  useWorkspaceStore.setState({ ...INITIAL_STATE });
}
