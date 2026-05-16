import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetcher, type FetchError } from '@/lib/api';
import { csrfHeaders } from '@/lib/csrf';
import { cn } from '@/lib/utils';

import { McpClientList } from './McpClientList';
import { McpCreateClientDialog, type McpClientScope } from './McpCreateClientDialog';
import { McpCredentialsPanel } from './McpCredentialsPanel';
import { McpEndpointRows } from './McpEndpointRows';
import type { McpCreatedClient, McpProxyManagerMode, McpProxyStatus, McpRole } from './types';

function isAdminRole(role: McpRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export interface McpProxyManagerProps {
  workspaceId: string | null;
  mode: McpProxyManagerMode;
  onDone?: () => void;
  className?: string;
}

/**
 * Reusable surface for the workspace MCP proxy. Used in both
 * `/settings/mcp` (mode='settings') and the onboarding step (mode='onboarding').
 *
 * Visible states:
 *   - workspace missing / no id        → recoverable empty state
 *   - SWR loading                       → muted placeholder
 *   - 403                               → owner/admin-only banner
 *   - 401                               → defers to parent; status hidden
 *   - available=false                   → "configuration disabled" banner
 *   - enabled=false                     → toggle + copy explaining the model
 *   - enabled=true                      → endpoints + clients + create form
 *   - just created a client             → one-time credentials panel
 */
export function McpProxyManager({ workspaceId, mode, onDone, className }: McpProxyManagerProps) {
  const router = useRouter();
  const url = workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy` : null;
  const { data, error, mutate, isLoading } = useSWR<McpProxyStatus>(url, fetcher);

  const status = (error as FetchError | undefined)?.status;
  const isForbidden = status === 403;
  const compact = mode === 'onboarding';

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<McpCreatedClient | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 401) {
      void router.replace('/sign_in');
    }
  }, [router, status]);

  const toggleEnabled = useCallback(
    async (next: boolean) => {
      if (!workspaceId || enabling) return;
      setEnabling(true);
      setEnableError(null);
      try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ enabled: next }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          setEnableError(humanizeError(payload.error ?? `status_${res.status}`));
          setEnabling(false);
          return;
        }
        if (!next) {
          // Disabling revokes all clients server-side — dismiss any one-time
          // secret panel that may still be on screen.
          setCredentials(null);
          setShowCreate(false);
        }
        await mutate();
      } catch {
        setEnableError('Network error. Try again.');
      } finally {
        setEnabling(false);
      }
    },
    [workspaceId, enabling, mutate],
  );

  const createClient = useCallback(
    async (input: { name: string; scope: McpClientScope }) => {
      if (!workspaceId || creating) return;
      setCreating(true);
      setCreateError(null);
      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy/clients`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
            body: JSON.stringify({ name: input.name, scope: input.scope }),
          },
        );
        const payload = (await res.json().catch(() => ({}))) as
          | (McpCreatedClient & { error?: string })
          | { error?: string };
        if (!res.ok) {
          setCreateError(humanizeError(payload.error ?? `status_${res.status}`));
          setCreating(false);
          return;
        }
        setCredentials(payload as McpCreatedClient);
        setShowCreate(false);
        await mutate();
      } catch {
        setCreateError('Network error. Try again.');
      } finally {
        setCreating(false);
      }
    },
    [workspaceId, creating, mutate],
  );

  const revokeClient = useCallback(
    async (clientId: string) => {
      if (!workspaceId) return;
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy/clients/${encodeURIComponent(clientId)}`,
        { method: 'DELETE', headers: csrfHeaders() },
      );
      if (!res.ok) {
        throw new Error('revoke_failed');
      }
      // If the user just created this client, hide its credentials panel —
      // the secret no longer works at the proxy.
      if (credentials?.client.id === clientId) {
        setCredentials(null);
      }
      await mutate();
    },
    [workspaceId, credentials, mutate],
  );

  const claimSelfClient = useCallback(async () => {
    if (!workspaceId || claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp-proxy/clients/self`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({}),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as
        | (McpCreatedClient & { error?: string })
        | { error?: string };
      if (!res.ok) {
        setClaimError(humanizeError(payload.error ?? `status_${res.status}`));
        setClaiming(false);
        return;
      }
      setCredentials(payload as McpCreatedClient);
      await mutate();
    } catch {
      setClaimError('Network error. Try again.');
    } finally {
      setClaiming(false);
    }
  }, [workspaceId, claiming, mutate]);

  if (!workspaceId) {
    return (
      <Banner
        tone="warn"
        compact={compact}
        title="Workspace not ready"
        body="MCP credentials become available once your workspace is ready. Come back from the dashboard."
      />
    );
  }

  if (isForbidden) {
    return (
      <Banner
        tone="warn"
        compact={compact}
        title="Only owners and admins can manage MCP access."
        body="Ask a workspace owner to create a client for you."
        testId="mcp-forbidden"
      />
    );
  }

  if (isLoading || !data) {
    if (error && status && status !== 401) {
      return (
        <Banner
          tone="warn"
          compact={compact}
          title="Couldn’t load MCP settings"
          body="Refresh the page to try again."
        />
      );
    }
    return <SkeletonPlaceholder compact={compact} />;
  }

  if (!data.available) {
    return (
      <Banner
        tone="muted"
        compact={compact}
        title="MCP proxy isn’t configured for this Open42 deployment"
        body="Ask your administrator to set OPEN42_GBRAIN_PROXY_DOMAIN to enable public MCP access."
      />
    );
  }

  const isEnabled = data.enabled;
  const admin = isAdminRole(data.role);
  const myClient = data.myClient ?? null;

  return (
    <div className={cn('space-y-5', className)}>
      <section
        aria-label="MCP proxy status"
        className={cn('rounded-xl border border-border-soft bg-white', compact ? 'p-4' : 'p-5')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-text-primary">MCP proxy</p>
            <p className="mt-0.5 text-[12.5px] text-text-subtle">
              {statusSubtitle(isEnabled, admin)}
            </p>
          </div>
          {admin ? (
            <ToggleButton
              enabled={isEnabled}
              busy={enabling}
              onToggle={() => void toggleEnabled(!isEnabled)}
            />
          ) : (
            <StatusPill enabled={isEnabled} />
          )}
        </div>
        {enableError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-destructive">
            {enableError}
          </p>
        ) : null}
      </section>

      {isEnabled ? (
        <>
          {!compact ? (
            <section aria-label="MCP endpoints">
              <SectionHeading>Endpoints</SectionHeading>
              <McpEndpointRows
                mcpUrl={data.mcpUrl}
                tokenUrl={data.issuerUrl ? `${data.issuerUrl}/token` : null}
                issuerUrl={data.issuerUrl}
                className="mt-3"
              />
            </section>
          ) : null}

          {!admin ? (
            <MemberClaimSection
              myClient={myClient}
              claiming={claiming}
              claimError={claimError}
              credentials={credentials}
              onClaim={() => void claimSelfClient()}
              onDismissCredentials={() => {
                setCredentials(null);
                onDone?.();
              }}
              onRevoke={revokeClient}
              compact={compact}
            />
          ) : (
            <section aria-label="MCP clients">
              <div className="flex items-center justify-between">
                <SectionHeading>Clients</SectionHeading>
                {!showCreate && !credentials ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setShowCreate(true);
                      setCreateError(null);
                    }}
                    data-testid="mcp-open-create"
                  >
                    Create client
                  </Button>
                ) : null}
              </div>

              {credentials ? (
                <div className="mt-3">
                  <McpCredentialsPanel
                    credentials={credentials}
                    onDismiss={() => {
                      setCredentials(null);
                      onDone?.();
                    }}
                    compact={compact}
                  />
                </div>
              ) : null}

              {showCreate ? (
                <div className="mt-3">
                  <McpCreateClientDialog
                    onSubmit={createClient}
                    onCancel={() => {
                      setShowCreate(false);
                      setCreateError(null);
                    }}
                    submitting={creating}
                    compact={compact}
                    error={createError}
                  />
                </div>
              ) : null}

              <div className="mt-3">
                <McpClientList
                  clients={data.clients}
                  onRevoke={revokeClient}
                  showRevoked={!compact}
                  emptyHint={
                    compact
                      ? 'Create one to plug this brain into Claude Code or another MCP client.'
                      : 'Each workspace member can also self-claim a personal client from Settings.'
                  }
                  compact={compact}
                />
              </div>
            </section>
          )}

          {compact ? (
            <McpEndpointRows
              mcpUrl={data.mcpUrl}
              tokenUrl={data.issuerUrl ? `${data.issuerUrl}/token` : null}
              issuerUrl={data.issuerUrl}
              compact
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function statusSubtitle(enabled: boolean, admin: boolean): string {
  if (admin) {
    return enabled
      ? 'Enabled. Issue named clients here, or invite members to self-claim their own credentials.'
      : 'MCP access is off by default. Turn it on to issue credentials.';
  }
  return enabled
    ? 'Enabled by your admin. Claim your personal credentials below.'
    : 'A workspace owner or admin needs to enable MCP access before you can claim credentials.';
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      role="status"
      aria-label={enabled ? 'MCP proxy enabled' : 'MCP proxy disabled'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em]',
        enabled
          ? 'border-blue-line bg-blue-soft text-blue'
          : 'border-border bg-panel-soft text-text-subtle',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', enabled ? 'bg-blue' : 'bg-text-faint')}
      />
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function MemberClaimSection({
  myClient,
  claiming,
  claimError,
  credentials,
  onClaim,
  onDismissCredentials,
  onRevoke,
  compact,
}: {
  myClient: McpProxyStatus['myClient'];
  claiming: boolean;
  claimError: string | null;
  credentials: McpCreatedClient | null;
  onClaim: () => void;
  onDismissCredentials: () => void;
  onRevoke: (clientId: string) => Promise<void>;
  compact?: boolean;
}) {
  return (
    <section aria-label="Your MCP credentials" data-testid="mcp-member-section">
      <SectionHeading>Your credentials</SectionHeading>
      {credentials ? (
        <div className="mt-3">
          <McpCredentialsPanel
            credentials={credentials}
            onDismiss={onDismissCredentials}
            compact={compact}
          />
        </div>
      ) : null}

      {!myClient && !credentials ? (
        <div
          className={cn(
            'mt-3 rounded-xl border border-blue-line bg-panel-blue',
            compact ? 'p-4' : 'p-5',
          )}
        >
          <p className="text-[13.5px] font-medium text-text-primary">
            Claim your personal MCP credentials
          </p>
          <p className="mt-1 max-w-[60ch] text-[12.5px] leading-snug text-text-body">
            We&rsquo;ll issue a read+write client tied to your account unless an admin decides
            otherwise. The secret appears once &mdash; copy it into your MCP client (Claude Code,
            Cursor, …) right after.
          </p>
          {claimError ? (
            <p role="alert" className="mt-2 text-[12.5px] text-destructive">
              {claimError}
            </p>
          ) : null}
          <div className="mt-3">
            <Button size="sm" onClick={onClaim} disabled={claiming} data-testid="mcp-claim-self">
              {claiming ? 'Claiming…' : 'Claim credentials'}
            </Button>
          </div>
        </div>
      ) : null}

      {myClient && !credentials ? (
        <div className="mt-3">
          <McpClientList
            clients={[myClient]}
            onRevoke={onRevoke}
            emptyHint={undefined}
            compact={compact}
          />
          <p className="mt-2 text-[11.5px] text-text-subtle">
            Revoke to invalidate the issued token. Once revoked you can claim a fresh one&mdash;the
            new secret is shown once.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
      {children}
    </h3>
  );
}

function ToggleButton({
  enabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="MCP proxy"
      onClick={onToggle}
      disabled={busy}
      data-testid="mcp-toggle"
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60',
        enabled ? 'border-blue-line bg-blue' : 'border-border bg-panel-soft',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform duration-200',
          enabled ? 'translate-x-[22px]' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function Banner({
  tone,
  compact,
  title,
  body,
  testId,
}: {
  tone: 'muted' | 'warn';
  compact?: boolean;
  title: string;
  body: string;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        'rounded-xl border',
        compact ? 'p-4' : 'p-5',
        tone === 'warn'
          ? 'border-orange-soft bg-orange-soft/40 text-text-body'
          : 'border-border-soft bg-panel-soft text-text-body',
      )}
    >
      <p className="text-[13px] font-medium text-text-primary">{title}</p>
      <p className="mt-1 max-w-[64ch] text-[12.5px] leading-snug">{body}</p>
    </div>
  );
}

function SkeletonPlaceholder({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className={cn('rounded-xl border border-border-soft bg-white', compact ? 'p-4' : 'p-5')}>
        <div className="h-3.5 w-32 rounded bg-panel-soft" />
        <div className="mt-2 h-3 w-64 rounded bg-panel-soft" />
      </div>
      <div className="rounded-xl border border-dashed border-border bg-white p-5">
        <div className="h-3 w-40 rounded bg-panel-soft" />
      </div>
    </div>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case 'mcp_proxy_domain_not_configured':
      return 'MCP proxy isn’t configured for this Open42 deployment.';
    case 'workspace_gbrain_not_ready':
      return 'Brain runtime isn’t ready yet. Give it a moment and try again.';
    case 'mcp_proxy_disabled':
      return 'Enable MCP access before creating a client.';
    case 'client_name_invalid':
      return 'Pick a name between 1 and 80 characters.';
    case 'client_scope_invalid':
      return 'Invalid scope.';
    case 'forbidden_cannot_manage_mcp_proxy':
      return 'Only workspace owners and admins can manage MCP access.';
    case 'status_403':
      return 'Only workspace owners and admins can manage MCP access.';
    case 'status_404':
      return 'Workspace not found.';
    case 'status_409':
      return 'Brain runtime isn’t ready yet. Give it a moment and try again.';
    case 'status_503':
      return 'MCP proxy isn’t configured for this Open42 deployment.';
    default:
      return 'Something went wrong. Try again.';
  }
}
