import { memo } from 'react';

import type { Citation } from './chat-types';
import { freshnessOf } from '@/lib/library-types';
import { cn } from '@/lib/utils';

interface ReceiptsRailProps {
  citations: Citation[];
  activeIndex: number | null;
  onActivate: (index: number) => void;
}

/**
 * Persistent right-rail of source cards (R-B from 2026-05-09 dashboard design).
 *
 * Every cited source from the latest assistant turn is visible without a
 * click — the brain shows its receipts. Hovering [n] in the prose calls
 * `onActivate(n)`, which lifts the matching card.
 */
export const ReceiptsRail = memo(function ReceiptsRail({
  citations,
  activeIndex,
  onActivate,
}: ReceiptsRailProps) {
  if (citations.length === 0) return null;

  return (
    <aside
      aria-label="Sources for the latest answer"
      className="hidden h-screen w-[340px] shrink-0 overflow-y-auto border-l border-border bg-white px-4 py-6 lg:block"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-text-faint">
        Sources · {citations.length}
      </p>
      <ul className="mt-4 space-y-2.5">
        {citations.map((c) => (
          <ReceiptCard
            key={c.index}
            citation={c}
            active={activeIndex === c.index}
            onActivate={onActivate}
          />
        ))}
      </ul>
    </aside>
  );
});

function ReceiptCard({
  citation,
  active,
  onActivate,
}: {
  citation: Citation;
  active: boolean;
  onActivate: (index: number) => void;
}) {
  const fresh = citation.last_updated ? safeFreshness(citation.last_updated) : null;
  const sourceWarning = warningForSourceStatus(citation.source_status);
  return (
    <li>
      <button
        type="button"
        onMouseEnter={() => onActivate(citation.index)}
        onFocus={() => onActivate(citation.index)}
        onClick={() => onActivate(citation.index)}
        aria-pressed={active}
        className={cn(
          'group block w-full rounded-2xl border bg-white px-3.5 py-3 text-left transition-[border-color,box-shadow] duration-140',
          active
            ? 'border-accent shadow-[0_0_0_3px_rgba(29,77,255,0.08)]'
            : 'border-border hover:border-accent/40',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-accent">
            [{citation.index}]
          </span>
          <span className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-text-primary">
            {citation.slug}
          </span>
        </div>
        {citation.excerpt ? (
          <p className="mt-1.5 border-l-2 border-accent/30 pl-2 text-[11.5px] leading-relaxed text-text-subtle">
            &ldquo;{citation.excerpt}&rdquo;
          </p>
        ) : null}
        {sourceWarning ? (
          <p className="mt-1.5 rounded-md bg-orange-soft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.04em] text-orange">
            {sourceWarning}
          </p>
        ) : null}
        {citation.last_updated ? (
          <div className="mt-1.5 font-mono text-[10px] text-text-faint">
            <span
              className={cn(
                fresh === 'aging' && 'text-amber-700',
                fresh === 'stale' && 'text-destructive',
              )}
            >
              updated {citation.last_updated}
            </span>
            {citation.version_id != null ? (
              <span> · v{citation.version_id}</span>
            ) : null}
          </div>
        ) : null}
      </button>
    </li>
  );
}

function warningForSourceStatus(status: string | null | undefined): string | null {
  switch (status) {
    case 'stale':
      return 'Repo source stale';
    case 'errored':
    case 'auth_required':
      return 'Repo sync needs repair';
    case 'degraded':
      return 'Repo sync degraded';
    default:
      return null;
  }
}

/**
 * `Citation.last_updated` is a free-form string from the chat backend — try to
 * parse it for freshness colour, but fall back silently if the format isn't
 * Date-friendly. Keeps the rail working when gbrain returns relative strings.
 */
function safeFreshness(raw: string) {
  if (Number.isNaN(new Date(raw).getTime())) return null;
  return freshnessOf(raw);
}
