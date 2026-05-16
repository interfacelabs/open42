import { FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type McpClientScope = 'read' | 'read write';

export interface McpCreateClientDialogProps {
  onSubmit: (input: { name: string; scope: McpClientScope }) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
  defaultName?: string;
  compact?: boolean;
  error?: string | null;
}

/**
 * Inline form for creating an MCP client. Rendered in place rather than as a
 * Radix modal — the same UI works in Settings and in the onboarding compact
 * panel, and avoids a portal that would steal focus from the surrounding
 * onboarding flow.
 */
export function McpCreateClientDialog({
  onSubmit,
  onCancel,
  submitting,
  defaultName = '',
  compact,
  error,
}: McpCreateClientDialogProps) {
  const [name, setName] = useState(defaultName);
  const [scope, setScope] = useState<McpClientScope>('read');
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setValidationError('Give the client a name so you can recognise it later.');
      return;
    }
    setValidationError(null);
    await onSubmit({ name: trimmed, scope });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'rounded-xl border border-border-soft bg-white',
        compact ? 'p-4' : 'p-5',
      )}
      noValidate
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        Create client
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-[12.5px] font-medium text-text-primary">Name</span>
          <input
            autoFocus
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Claude Code"
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary placeholder:text-text-faint focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft"
          />
        </label>
        <label className="block">
          <span className="text-[12.5px] font-medium text-text-primary">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as McpClientScope)}
            className="mt-1.5 h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft sm:w-44"
          >
            <option value="read">read</option>
            <option value="read write">read write</option>
          </select>
        </label>
      </div>

      {validationError || error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {validationError ?? error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create client'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
