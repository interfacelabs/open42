import { useState } from 'react';
import { Trash2 } from 'lucide-react';

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

import type { Member } from './types';

/**
 * Members list — visible to all roles, but only managers (owner/admin)
 * see the role dropdown and remove button on rows that are not their
 * own and not the workspace owner. Each row owns its mutation state.
 * The Remove action is gated behind an AlertDialog (styled) instead of
 * the native window.confirm() so the UX matches the rest of the app.
 */
export function MembersCard({
  wsId,
  members,
  myUserId,
  isManager,
  onChanged,
}: {
  wsId: string | null;
  members: Member[];
  myUserId: string | null;
  isManager: boolean;
  onChanged: () => void;
}) {
  return (
    <section data-testid="members-card" className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-text-subtle">
        Members
      </h2>
      {members.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-white p-8 text-center">
          <p className="text-sm text-text-subtle">No members yet.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              wsId={wsId}
              member={m}
              isSelf={m.userId === myUserId}
              isManager={isManager}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({
  wsId,
  member,
  isSelf,
  isManager,
  onChanged,
}: {
  wsId: string | null;
  member: Member;
  isSelf: boolean;
  isManager: boolean;
  onChanged: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerRow = member.role === 'owner';
  const canMutate = isManager && !isSelf && !ownerRow;

  async function changeRole(newRole: 'admin' | 'member') {
    if (!wsId || updating) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        setError('Could not update role.');
        setUpdating(false);
        return;
      }
      onChanged();
    } catch {
      setError('Network error.');
    } finally {
      setUpdating(false);
    }
  }

  async function remove() {
    if (!wsId || removing) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members/${member.userId}`, {
        method: 'DELETE',
        headers: csrfHeaders(),
      });
      if (!res.ok) {
        setError('Could not remove member.');
        setRemoving(false);
        return;
      }
      onChanged();
    } catch {
      setError('Network error.');
      setRemoving(false);
    }
  }

  return (
    <li>
      <article className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">
            {member.email}
            {isSelf ? (
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-text-subtle">
                you
              </span>
            ) : null}
          </p>
          <p className="mt-1 font-mono text-xs text-text-subtle">
            joined {new Date(member.joinedAt).toLocaleDateString()}
          </p>
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canMutate ? (
            <>
              <select
                data-testid={`member-role-${member.userId}`}
                value={member.role}
                onChange={(e) => void changeRole(e.target.value as 'admin' | 'member')}
                disabled={updating}
                aria-label={`Role for ${member.email}`}
                className="h-9 rounded-input border border-border bg-white px-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removing}
                    data-testid={`member-remove-${member.userId}`}
                    aria-label={`Remove ${member.email}`}
                  >
                    <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                    {removing ? 'Removing...' : 'Remove'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Remove {member.email} from this workspace?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      They&rsquo;ll immediately lose access. They can be
                      re-invited later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid={`member-remove-confirm-${member.userId}`}
                      onClick={() => void remove()}
                    >
                      Remove member
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-subtle">
              {member.role}
            </span>
          )}
        </div>
      </article>
    </li>
  );
}
