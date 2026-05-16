import { useCallback, useState } from 'react';
import { Check, Copy, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { McpCreatedClient } from './types';

export interface McpCredentialsPanelProps {
  credentials: McpCreatedClient;
  onDismiss: () => void;
  compact?: boolean;
}

/**
 * One-time credentials view. Rendered after `POST /mcp-proxy/clients` succeeds.
 * The client secret is held in component state (never persisted) and
 * disappears the moment the panel is dismissed.
 */
export function McpCredentialsPanel({
  credentials,
  onDismiss,
  compact,
}: McpCredentialsPanelProps) {
  const rows: Array<{ id: string; label: string; value: string; mono: boolean; secret?: boolean }> = [
    { id: 'mcp', label: 'MCP URL', value: credentials.mcpUrl, mono: true },
    { id: 'token', label: 'Token URL', value: credentials.tokenUrl, mono: true },
    { id: 'issuer', label: 'Issuer URL', value: credentials.issuerUrl, mono: true },
    { id: 'client-id', label: 'Client ID', value: credentials.clientId, mono: true },
    {
      id: 'client-secret',
      label: 'Client secret',
      value: credentials.clientSecret,
      mono: true,
      secret: true,
    },
    { id: 'scope', label: 'Scope', value: credentials.scope, mono: true },
    { id: 'grant', label: 'Grant', value: credentials.grantType, mono: true },
  ];

  return (
    <section
      role="region"
      aria-label="MCP client credentials"
      data-testid="mcp-credentials-panel"
      className={cn(
        'rounded-xl border border-blue-line bg-panel-blue',
        compact ? 'p-4' : 'p-5',
      )}
    >
      <header className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-blue-line bg-white text-blue">
          <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-text-primary">
            {credentials.client.label} · credentials
          </h3>
          <p className="mt-1 max-w-[64ch] text-[12.5px] leading-snug text-text-body">
            The secret is shown once. Store it in your MCP client now — Open42 keeps only a
            hash and can&rsquo;t show it again.
          </p>
        </div>
      </header>

      <dl className="mt-4 space-y-2">
        {rows.map((row) => (
          <CredentialRow key={row.id} {...row} />
        ))}
      </dl>

      <div className="mt-5 flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          I&rsquo;ve stored it
        </Button>
      </div>
    </section>
  );
}

function CredentialRow({
  label,
  value,
  mono,
  secret,
}: {
  label: string;
  value: string;
  mono: boolean;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // no-op
    }
  }, [value]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-line bg-white px-3 py-2">
      <span className="w-24 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        {label}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px] text-text-body',
          mono && 'font-mono',
        )}
        data-secret={secret ? '' : undefined}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-soft bg-white text-text-subtle transition-colors duration-140 hover:border-border hover:text-text-primary"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}
