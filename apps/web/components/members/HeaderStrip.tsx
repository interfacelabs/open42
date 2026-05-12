import type { WorkspaceStatus } from './types';

/**
 * Title-strip line under the Members page header: seat counts plus an
 * optional workspace status badge (provisioning / failed). Pure presentation.
 */
export function HeaderStrip({
  memberCount,
  pendingCount,
  workspace,
}: {
  memberCount: number;
  pendingCount: number;
  workspace: { status: WorkspaceStatus } | null;
}) {
  const memberLabel = `${memberCount} member${memberCount === 1 ? '' : 's'}`;
  const inviteLabel = `${pendingCount} pending invite${pendingCount === 1 ? '' : 's'}`;
  return (
    <div className="mt-6 flex items-center gap-3">
      <span
        data-testid="members-header-counts"
        className="font-mono text-xs text-text-subtle"
      >
        {memberLabel} &middot; {inviteLabel}
      </span>
      {workspace?.status === 'provisioning' ? (
        <span
          data-testid="workspace-status-badge"
          className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-accent-deep"
        >
          provisioning
        </span>
      ) : null}
      {workspace?.status === 'failed' ? (
        <span
          data-testid="workspace-status-badge"
          className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-red-700"
        >
          failed
        </span>
      ) : null}
    </div>
  );
}
