import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useSWR from 'swr';

import { AccessDenied } from '@/components/members/AccessDenied';
import { HeaderStrip } from '@/components/members/HeaderStrip';
import { InviteCard } from '@/components/members/InviteCard';
import { MembersCard } from '@/components/members/MembersCard';
import { PendingInvitesCard } from '@/components/members/PendingInvitesCard';
import type { Invite, Member, Role } from '@/components/members/types';
import { Sidebar } from '@/components/Sidebar';
import { fetcher } from '@/lib/api';
import { useWorkspaceStore } from '@/lib/workspaces/store';
import { recoverFromTenant403 } from '@/lib/workspaces/with-recovery';

/**
 * Members settings page — owners/admins manage memberships and invites
 * for the current workspace; plain members see a read-only list.
 *
 * Data lives in two SWR keys to keep cache invalidation per-card crisp:
 *   - `/api/workspaces/:id/members`   → members list (any role)
 *   - `/api/workspaces/:id/invites`   → pending invites (owner/admin only)
 *
 * Workspace identity comes from `useWorkspaceStore.currentWorkspaceId` —
 * the URL doesn't carry a workspace id because the switcher already owns
 * "which workspace am I looking at" in the UI.
 *
 * 403 recovery: when /members returns 403 the caller is no longer a member
 * (kicked, or the cookie points at a workspace the user lost access to).
 * We render an access-denied empty state AND kick off the store's
 * recoverFromForbidden flow — which either switches the user into another
 * workspace they own or bounces them to onboarding.
 *
 * Card-level components live under `@/components/members/`. They receive
 * data + onChanged callbacks via props; this page owns all SWR and the
 * route-level side effects (401/403/404 → router.replace).
 */

interface MeResponse {
  id: string;
  email: string;
}

function errStatus(err: unknown): number | undefined {
  return (err as { status?: number } | undefined)?.status;
}

export default function MembersSettingsPage() {
  const router = useRouter();
  const store = useWorkspaceStore();
  const workspace = store.workspaces.find((w) => w.id === store.currentWorkspaceId) ?? null;
  const wsId = workspace?.id ?? null;

  const meSwr = useSWR<MeResponse>('/api/auth/me', fetcher);
  const membersSwr = useSWR<{ members: Member[] }>(
    wsId ? `/api/workspaces/${wsId}/members` : null,
    fetcher,
  );
  const invitesSwr = useSWR<{ invites: Invite[] }>(
    wsId ? `/api/workspaces/${wsId}/invites` : null,
    fetcher,
  );

  // 401 anywhere → sign in.
  useEffect(() => {
    if (errStatus(meSwr.error) === 401 || errStatus(membersSwr.error) === 401) {
      void router.replace('/sign_in');
    }
  }, [meSwr.error, membersSwr.error, router]);

  // 404 from /members → workspace was soft-deleted; bounce home.
  useEffect(() => {
    if (errStatus(membersSwr.error) === 404) {
      void router.replace('/');
    }
  }, [membersSwr.error, router]);

  // 403 from /members → caller is not a member (kicked, or cookie pointed at
  // a workspace they lost). Render the access-denied state immediately, drop
  // the cached 403 errors from both SWR keys so a return navigation doesn't
  // replay the stale failure, then run the recovery flow (switch or onboard).
  const isAccessDenied = errStatus(membersSwr.error) === 403;
  const mutateMembers = membersSwr.mutate;
  const mutateInvites = invitesSwr.mutate;
  useEffect(() => {
    if (!isAccessDenied) return;
    let cancelled = false;
    void (async () => {
      await mutateMembers(undefined, { revalidate: false });
      await mutateInvites(undefined, { revalidate: false });
      if (cancelled) return;
      await recoverFromTenant403();
    })();
    return () => {
      cancelled = true;
    };
  }, [isAccessDenied, mutateMembers, mutateInvites]);

  const me = meSwr.data ?? null;
  const members = membersSwr.data?.members ?? [];
  const pendingInvites = (invitesSwr.data?.invites ?? []).filter((i) => i.status === 'pending');

  // Caller's role within this workspace. Prefer the members listing
  // (authoritative; admin/owner-only views may not have store.role for
  // every workspace), fall back to the store hint.
  const myRow = me ? members.find((m) => m.userId === me.id) : null;
  const myRole: Role | null = myRow?.role ?? workspace?.role ?? null;
  const isManager = myRole === 'owner' || myRole === 'admin';

  return (
    <>
      <Head>
        <title>Members - Open42</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 px-10 py-10">
          <div className="max-w-3xl">
            <header>
              <p className="font-mono text-xs text-text-subtle">SETTINGS</p>
              <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
                Members
              </h1>
              <p className="mt-3 max-w-[58ch] text-sm leading-body text-text-body">
                Manage who has access to this workspace. Owners and admins can
                invite teammates, change roles, and remove members.
              </p>
              <HeaderStrip
                memberCount={members.length}
                pendingCount={pendingInvites.length}
                workspace={workspace}
              />
            </header>

            {isAccessDenied ? (
              <AccessDenied />
            ) : (
              <>
                {isManager ? (
                  <>
                    <InviteCard
                      wsId={wsId}
                      workspaceStatus={workspace?.status ?? 'ready'}
                      onSent={() => invitesSwr.mutate()}
                    />
                    <PendingInvitesCard
                      wsId={wsId}
                      invites={pendingInvites}
                      onChanged={() => invitesSwr.mutate()}
                    />
                  </>
                ) : null}
                <MembersCard
                  wsId={wsId}
                  members={members}
                  myUserId={me?.id ?? null}
                  isManager={isManager}
                  onChanged={() => membersSwr.mutate()}
                />
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
