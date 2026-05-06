import { memo } from 'react';

import type { Citation } from './chat-types';

interface CitationChipProps {
  citation: Citation;
  onSelect: (citation: Citation) => void;
}

function CitationChipBase({ citation, onSelect }: CitationChipProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(citation)}
      title={`${citation.slug}${citation.last_updated ? ` - updated ${citation.last_updated}` : ''}`}
      className="mx-1 inline-flex h-6 translate-y-[-1px] items-center rounded-md border border-border bg-muted px-2 font-mono text-[11px] text-text-body transition-all duration-140 hover:-translate-y-0.5 hover:border-input"
    >
      [{citation.index}]
    </button>
  );
}

export const CitationChip = memo(CitationChipBase);
