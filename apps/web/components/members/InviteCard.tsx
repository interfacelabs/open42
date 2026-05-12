import { FormEvent, useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { INVITE_EMAIL_LIMIT, isValidInviteEmail, parseInviteEmails } from '@/lib/email-parser';

import type { WorkspaceStatus } from './types';

/**
 * Invite card — textarea + role select + submit. Owns its own form state
 * (text, role, in-flight submitting, per-email failures, success count).
 * Tells the page when invites have been sent via `onSent` so the page can
 * revalidate the pending-invites SWR cache.
 */
export function InviteCard({
  wsId,
  workspaceStatus,
  onSent,
}: {
  wsId: string | null;
  workspaceStatus: WorkspaceStatus;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ email: string; reason: string }>>([]);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const lines = useMemo(() => parseInviteEmails(text), [text]);
  const invalid = lines.find((l) => !isValidInviteEmail(l));
  const overLimit = lines.length > INVITE_EMAIL_LIMIT;
  const disabledByStatus = workspaceStatus === 'failed';
  const canSubmit =
    !submitting &&
    !disabledByStatus &&
    lines.length > 0 &&
    !invalid &&
    !overLimit &&
    !!wsId;

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit || !wsId) return;
      setSubmitting(true);
      setError(null);
      setFailed([]);
      setSentCount(null);
      try {
        const res = await fetch(`/api/workspaces/${wsId}/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ emails: lines, role }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          sent?: number;
          failed?: Array<{ email: string; reason: string }>;
          error?: string;
        };
        if (!res.ok) {
          setError(payload.error ?? 'invites_failed');
          setSubmitting(false);
          return;
        }
        setSentCount(payload.sent ?? 0);
        setFailed(payload.failed ?? []);
        if ((payload.sent ?? 0) > 0 && (payload.failed ?? []).length === 0) {
          setText('');
        }
        onSent();
      } catch {
        setError('network_error');
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, lines, onSent, role, wsId],
  );

  return (
    <section data-testid="invite-form" className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-text-subtle">
        Invite teammates
      </h2>
      <form
        onSubmit={onSubmit}
        className="mt-4 space-y-4 rounded-2xl border border-border bg-white p-6"
        noValidate
      >
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-subtle">
            Email addresses
          </span>
          <textarea
            id="invite-emails"
            aria-label="Email addresses"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            disabled={disabledByStatus}
            placeholder="founder@speedrun.dev, ops@speedrun.dev"
            className="mt-1.5 w-full rounded-input border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-text-subtle">
            Comma, semicolon, or newline-separated. {INVITE_EMAIL_LIMIT} per batch.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-subtle">
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            disabled={disabledByStatus}
            className="mt-1.5 h-10 w-full rounded-input border border-border bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        {disabledByStatus ? (
          <p className="text-xs text-text-subtle">
            Workspace runtime hit an error &mdash; resolve it before inviting new members.
          </p>
        ) : null}

        {invalid ? (
          <p role="alert" className="text-sm text-red-600">
            <code className="font-mono text-xs">{invalid}</code> isn&rsquo;t a valid email.
          </p>
        ) : null}
        {overLimit ? (
          <p role="alert" className="text-sm text-red-600">
            Up to {INVITE_EMAIL_LIMIT} emails per batch.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {failed.length > 0 ? (
          <ul className="space-y-1 rounded-md bg-secondary p-3">
            {failed.map((f) => (
              <li key={f.email} className="font-mono text-xs text-text-body">
                <span className="text-text-primary">{f.email}</span> &mdash; {f.reason}
              </li>
            ))}
          </ul>
        ) : null}

        {sentCount !== null && sentCount > 0 && failed.length === 0 ? (
          <p role="status" className="text-sm text-emerald-700">
            Sent {sentCount} invite{sentCount === 1 ? '' : 's'}.
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={!canSubmit} size="sm">
            {submitting ? 'Sending...' : 'Send invites'}
          </Button>
        </div>
      </form>
    </section>
  );
}
