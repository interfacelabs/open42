import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EndpointRow {
  id: string;
  label: string;
  value: string | null;
}

export interface McpEndpointRowsProps {
  mcpUrl: string | null;
  tokenUrl: string | null;
  issuerUrl: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * Read-only rows showing the workspace's public MCP endpoints with a copy
 * affordance per row. Used in both Settings and the onboarding compact panel.
 */
export function McpEndpointRows({
  mcpUrl,
  tokenUrl,
  issuerUrl,
  className,
  compact = false,
}: McpEndpointRowsProps) {
  const rows: EndpointRow[] = [
    { id: 'mcp', label: 'MCP URL', value: mcpUrl },
    { id: 'token', label: 'Token URL', value: tokenUrl },
    { id: 'issuer', label: 'Issuer URL', value: issuerUrl },
  ];

  return (
    <dl
      className={cn(
        'rounded-xl border border-border-soft bg-white',
        compact ? 'divide-y divide-border-soft' : 'divide-y divide-border-soft',
        className,
      )}
    >
      {rows.map((row) => (
        <EndpointRowItem key={row.id} row={row} compact={compact} />
      ))}
    </dl>
  );
}

function EndpointRowItem({ row, compact }: { row: EndpointRow; compact: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3',
        compact ? 'px-3.5 py-2.5' : 'px-4 py-3',
      )}
    >
      <dt className="w-24 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        {row.label}
      </dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-body">
        {row.value ?? <span className="text-text-faint">—</span>}
      </dd>
      <CopyButton value={row.value} label={row.label} />
    </div>
  );
}

export function CopyButton({
  value,
  label,
  size = 'sm',
}: {
  value: string | null;
  label: string;
  size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard blocked — surface a soft visual fallback. The label still
      // works for assistive tech.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      disabled={!value}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border border-border-soft bg-white text-text-subtle transition-colors duration-140 hover:border-border hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );
}
