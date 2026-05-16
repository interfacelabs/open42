import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/api';
import { cn } from '@/lib/utils';

import type { McpClient } from './types';

export interface McpClientListProps {
  clients: McpClient[];
  onRevoke: (clientId: string) => Promise<void>;
  showRevoked?: boolean;
  emptyHint?: string;
  compact?: boolean;
}

/**
 * Renders the workspace's MCP clients. Active rows expose a Revoke action;
 * revoked rows are visible only when `showRevoked` is true (a small toggle in
 * Settings, hidden in onboarding's compact panel by default).
 */
export function McpClientList({
  clients,
  onRevoke,
  showRevoked,
  emptyHint,
  compact,
}: McpClientListProps) {
  const active = clients.filter((c) => !c.revokedAt);
  const revoked = clients.filter((c) => c.revokedAt);

  if (active.length === 0 && (!showRevoked || revoked.length === 0)) {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-border bg-white text-center text-text-subtle',
          compact ? 'px-4 py-5 text-[12.5px]' : 'px-5 py-7 text-[13px]',
        )}
      >
        <p className="font-medium text-text-primary">No MCP clients yet.</p>
        {emptyHint ? <p className="mt-1.5 text-text-subtle">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {active.map((client) => (
        <ClientRow
          key={client.id}
          client={client}
          onRevoke={onRevoke}
          compact={compact}
        />
      ))}
      {showRevoked && revoked.length > 0 ? (
        <details className="rounded-xl border border-border-soft bg-panel-soft px-4 py-3 text-[12.5px] text-text-subtle">
          <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
            Revoked ({revoked.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {revoked.map((client) => (
              <li key={client.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] text-text-body">{client.label}</span>
                <span className="font-mono text-[10.5px] text-text-faint">
                  revoked {client.revokedAt ? formatRelative(client.revokedAt) : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ClientRow({
  client,
  onRevoke,
  compact,
}: {
  client: McpClient;
  onRevoke: (clientId: string) => Promise<void>;
  compact?: boolean;
}) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async () => {
    if (revoking) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Revoke "${client.label}"? Existing issued tokens stop working at the Open42 proxy.`,
      );
      if (!ok) return;
    }
    setRevoking(true);
    setError(null);
    try {
      await onRevoke(client.id);
    } catch {
      setError('Could not revoke. Try again.');
      setRevoking(false);
    }
  };

  return (
    <article
      role="region"
      aria-label={`MCP client ${client.label}`}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border-soft bg-white p-4 sm:flex-row sm:items-center sm:justify-between',
        compact && 'p-3.5',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-text-primary">{client.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-text-subtle">
          <span>scopes: {client.scopes}</span>
          <span>created {formatRelative(client.createdAt)}</span>
          <span>
            {client.lastUsedAt
              ? `last used ${formatRelative(client.lastUsedAt)}`
              : 'never used'}
          </span>
        </div>
        {error ? <p className="mt-1.5 text-[12px] text-destructive">{error}</p> : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleRevoke()}
        disabled={revoking}
        aria-label={`Revoke ${client.label}`}
      >
        {revoking ? 'Revoking…' : 'Revoke'}
      </Button>
    </article>
  );
}
