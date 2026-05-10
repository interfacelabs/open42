import { memo } from 'react';

import type { Citation } from './chat-types';
import { cn } from '@/lib/utils';

interface CitationChipProps {
  citation: Citation;
  active: boolean;
  onActivate: (index: number) => void;
}

/**
 * Inline citation chip. Hovering or focusing the chip activates the matching
 * card in the persistent ReceiptsRail. Click also activates — kept here as a
 * fallback for keyboard / touch.
 */
function CitationChipBase({ citation, active, onActivate }: CitationChipProps) {
  return (
    <button
      type="button"
      onMouseEnter={() => onActivate(citation.index)}
      onFocus={() => onActivate(citation.index)}
      onClick={() => onActivate(citation.index)}
      aria-pressed={active}
      title={`${citation.slug}${citation.last_updated ? ` — updated ${citation.last_updated}` : ''}`}
      className={cn(
        'mx-1 inline-flex h-6 translate-y-[-1px] items-center rounded-md border px-2 font-mono text-[11px] transition-[color,background-color,border-color,transform] duration-140',
        active
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border bg-muted text-text-body hover:-translate-y-0.5 hover:border-input',
      )}
    >
      [{citation.index}]
    </button>
  );
}

export const CitationChip = memo(CitationChipBase);
