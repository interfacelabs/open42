import { useState } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';

import type { Invite } from './types';

/**
 * Pending invites list — owners/admins only. Empty-state when there are
 * none. Each row owns its resend/revoke mutation state so spinners and
 * error copy are scoped to the row that issued the request. The Revoke
 * action is gated behind an AlertDialog (styled) instead of the native
 * window.confirm() so the UX matches the rest of the app.
 */
export function PendingInvitesCard({
  wsId,
  invites,
  onChanged,
}: {
  wsId: string | null;
  invites: Invite[];
  onChanged: () => void;
}) {
  return (
    <section data-testid="pending-invites-card" className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-text-subtle">
        Pending invites
      </h2>
      {invites.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-white p-8 text-center">
          <p className="text-sm text-text-subtle">No pending invites.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {invites.map((inv) => (
            <PendingInviteRow
              key={inv.id}
              wsId={wsId}
              invite={inv}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingInviteRow({
  wsId,
  invite,
  onChanged,
}: {
  wsId: string | null;
  invite: Invite;
  onChanged: () => void;
}) {
  const [resending, setResending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!wsId || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${wsId}/invites/${invite.id}/resend`,
        { method: 'POST', headers: csrfHeaders() },
      );
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          retry_after_ms?: number;
        };
        const secs = Math.ceil((body.retry_after_ms ?? 60_000) / 1000);
        setError(`Try again in ${secs} second${secs === 1 ? '' : 's'}.`);
        setResending(false);
        return;
      }
      if (!res.ok) {
        setError('Could not resend. Try again.');
        setResending(false);
        return;
      }
      onChanged();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setResending(false);
    }
  }

  async function revoke() {
    if (!wsId || revoking) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${wsId}/invites/${invite.id}`,
        { method: 'DELETE', headers: csrfHeaders() },
      );
      if (!res.ok) {
        setError('Could not revoke. Try again.');
        setRevoking(false);
        return;
      }
      onChanged();
    } catch {
      setError('Network error. Try again.');
      setRevoking(false);
    }
  }

  return (
    <li>
      <article className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{invite.email}</p>
          <p className="mt-1 font-mono text-xs text-text-subtle">
            {invite.role} &middot; sent {new Date(invite.createdAt).toLocaleDateString()}
          </p>
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={resending}
            onClick={() => void resend()}
            data-testid={`invite-resend-${invite.id}`}
            aria-label={`Resend invite to ${invite.email}`}
          >
            <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.5} />
            {resending ? 'Resending...' : 'Resend'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={revoking}
                data-testid={`invite-revoke-${invite.id}`}
                aria-label={`Revoke invite to ${invite.email}`}
              >
                <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                {revoking ? 'Revoking...' : 'Revoke'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Revoke invite for {invite.email}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  They won&rsquo;t be able to accept this invite. You can
                  re-invite them anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  data-testid={`invite-revoke-confirm-${invite.id}`}
                  onClick={() => void revoke()}
                >
                  Revoke invite
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </article>
    </li>
  );
}
