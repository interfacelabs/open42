/**
 * Pure-logic core of the invite-accept page (lifted out of the IIFE that used
 * to live inside `accept.tsx`'s useEffect — codex round-7 follow-up).
 *
 * The page still owns the side effects tied to the DOM: sessionStorage
 * reads/writes, URL hash stripping, router.replace. This module owns the
 * three branches that depend only on fetch + the workspace store:
 *
 *   B1 — signed in, email matches: POST /accept, refresh + switch the store.
 *   B2 — signed in, email mismatches: optionally verify access_token; if not
 *        present, surface the mismatch UI so the user can sign out.
 *   B3 — not signed in: fall through to /auth/verify with the tokenHash
 *        (or access_token, when Supabase delivered it in the URL hash).
 *
 * Returning a tagged outcome (instead of calling setState directly) keeps the
 * flow trivially testable without a React tree.
 */
import { csrfHeaders } from '@/lib/csrf';
import { useWorkspaceStore } from '@/lib/workspaces/store';

export interface AcceptFlowInput {
  inviteId: string;
  tokenHash: string;
  type: string;
  accessToken: string | null;
}

export type AcceptFlowOutcome =
  | { kind: 'redirect'; to: string }
  | { kind: 'mismatch' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export interface AcceptFlowDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Defaults to useWorkspaceStore.getState().refresh(). */
  refreshStore?: () => Promise<void>;
  /** Defaults to useWorkspaceStore.getState().switchTo(id). */
  switchStoreTo?: (id: string) => Promise<void>;
  /**
   * Called on every terminal-success path. The page wires this to a
   * sessionStorage.removeItem(PENDING_KEY) so the next mount doesn't try to
   * replay the stash. Defaults to a no-op (e.g. for tests).
   */
  clearPendingStash?: () => void;
}

/**
 * Implements B1/B2/B3 branching, the access_token verify-in-mismatch (codex
 * round-6 P2), and the post-accept switchTo (codex round-6 P1). Returns an
 * outcome the page renders. Does NOT touch sessionStorage / location /
 * router — those stay in the page where the DOM lives.
 */
export async function runAcceptFlow(
  input: AcceptFlowInput,
  deps: AcceptFlowDeps = {},
): Promise<AcceptFlowOutcome> {
  const { inviteId, tokenHash, type, accessToken } = input;
  const fetchImpl: typeof fetch =
    deps.fetch ?? ((...args) => (globalThis.fetch as typeof fetch)(...args));
  const refreshStore =
    deps.refreshStore ?? (() => useWorkspaceStore.getState().refresh());
  const switchStoreTo =
    deps.switchStoreTo ?? ((id: string) => useWorkspaceStore.getState().switchTo(id));
  const clearPendingStash = deps.clearPendingStash ?? (() => {});

  // 5. Branch on /auth/me.
  let meEmail: string | null = null;
  try {
    const meRes = await fetchImpl('/api/auth/me', { method: 'GET' });
    if (meRes.ok) {
      const me = (await meRes
        .json()
        .catch(() => null)) as { email?: string } | null;
      meEmail = me?.email ?? null;
    }
  } catch {
    meEmail = null;
  }

  if (meEmail) {
    // B1 or B2: POST optimistically, branch on response.
    // The accept endpoint mutates state (workspace_members insert,
    // workspace_invites status flip) and is gated by CSRF middleware.
    const acceptRes = await fetchImpl(
      `/api/workspaces/invites/${encodeURIComponent(inviteId)}/accept`,
      { method: 'POST', headers: csrfHeaders() },
    );
    if (acceptRes.ok) {
      // The server flipped users.current_workspace_id to the invite's
      // workspace. Refresh the workspace store BEFORE redirecting so the
      // dashboard mounts with the new workspace already selected —
      // useHydrateWorkspaceStore's `_hydrated` latch prevents a second
      // refresh on the next page, which would otherwise leave the store
      // empty / pointed at a stale workspace (codex round-3 P2).
      //
      // Codex round-6 P1: refresh()'s resolution order prefers the local
      // current workspace when it's still a valid membership. After an
      // already-onboarded user accepts an invite, the previous workspace
      // is still in the membership list, so refresh() leaves the store
      // pinned to the OLD workspace and chat/dashboard send the wrong
      // workspace_id. Force-switch onto the workspace the accept response
      // carries.
      const acceptBody = (await acceptRes.json().catch(() => ({}))) as {
        workspace?: { id: string };
      };
      clearPendingStash();
      await refreshStore();
      if (acceptBody.workspace?.id) {
        try {
          await switchStoreTo(acceptBody.workspace.id);
        } catch {
          // An "already on this workspace" switch can throw benignly;
          // refresh() above already reconciled the rest of the store.
        }
      }
      return { kind: 'redirect', to: '/' };
    }
    const body = (await acceptRes.json().catch(() => ({}))) as {
      error?: string;
    };
    switch (body.error) {
      case 'invite_email_mismatch': {
        // Codex round-6 P2: if Supabase delivered the invite via URL hash
        // with an access_token (not just a tokenHash), the access_token
        // already authenticates the user as the *invitee's* identity —
        // there's no need to make the user sign out of their current
        // session and reload. POST /auth/verify with the access_token: the
        // backend will replace the session, accept the invite, and hand us
        // a redirect. We deliberately don't stash the access_token (XSS
        // surface), and we don't fall through to the sign-out UI when we
        // have a credential that can resolve this in one round-trip.
        if (accessToken) {
          const verifyRes = await fetchImpl('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken, inviteId }),
          });
          const verifyBody = (await verifyRes.json().catch(() => ({}))) as {
            redirectTo?: string;
            error?: string;
          };
          if (verifyRes.ok) {
            clearPendingStash();
            await refreshStore();
            return { kind: 'redirect', to: verifyBody.redirectTo ?? '/' };
          }
          if (
            verifyBody.error === 'invite_expired' ||
            verifyBody.error === 'otp_expired'
          )
            return { kind: 'expired' };
          if (verifyBody.error === 'invite_revoked')
            return { kind: 'error', message: 'invite_revoked' };
          if (verifyBody.error === 'invite_email_mismatch')
            // Backend disagrees that the access_token authenticates the
            // invitee — fall through to the legacy sign-out UI rather
            // than loop.
            return { kind: 'mismatch' };
          return { kind: 'error', message: verifyBody.error ?? 'unknown' };
        }
        // No access_token — keep the stash so the post-signout reload can
        // pick the tokenHash up and replay Path A.
        return { kind: 'mismatch' };
      }
      case 'invite_revoked':
        return { kind: 'error', message: 'invite_revoked' };
      case 'invite_already_accepted':
        clearPendingStash();
        // Even on already-accepted we refresh — the user may have switched
        // workspaces in another tab; hydrating from the server reconciles
        // the dashboard against the latest state.
        await refreshStore();
        return { kind: 'redirect', to: '/' };
      case 'invite_expired':
        return { kind: 'expired' };
      default:
        return { kind: 'error', message: body.error ?? 'unknown' };
    }
  }

  // B3: not signed in — existing Path A through /auth/verify.
  const res = await fetchImpl('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      accessToken ? { accessToken, inviteId } : { tokenHash, type, inviteId },
    ),
  });
  const body = (await res.json().catch(() => ({}))) as {
    redirectTo?: string;
    error?: string;
  };
  if (res.ok) {
    clearPendingStash();
    return { kind: 'redirect', to: body.redirectTo ?? '/' };
  }
  if (body.error === 'invite_expired' || body.error === 'otp_expired')
    return { kind: 'expired' };
  if (body.error === 'invite_email_mismatch') return { kind: 'mismatch' };
  if (body.error === 'invite_revoked')
    return { kind: 'error', message: 'invite_revoked' };
  return { kind: 'error', message: body.error ?? 'unknown' };
}
