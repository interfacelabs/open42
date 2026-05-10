import { ExternalLink, Sparkles, X } from 'lucide-react';
import useSWR from 'swr';

import { SlideOver } from '@/components/SlideOver';
import { Button } from '@/components/ui/button';
import { fetcher, formatRelative, type FetchError } from '@/lib/api';
import { freshnessOf, type LibraryDoc } from '@/lib/library-types';
import { cn } from '@/lib/utils';

/**
 * Right-side slide-over showing one document with full body + tags + receipts
 * affordances ("ask brain about this", open in source). DT-B from the
 * 2026-05-09 dashboard design.
 */
export function DocPanel({
  docId,
  onClose,
}: {
  docId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSWR<{ doc: LibraryDoc }, FetchError>(
    docId ? `/api/library/doc/${encodeURIComponent(docId)}` : null,
    fetcher,
  );

  const doc = data?.doc ?? null;

  return (
    <SlideOver
      open={!!docId}
      onClose={onClose}
      width="md"
      ariaLabel={doc?.title ?? 'Document detail'}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
          esc · close
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-text-faint transition-colors duration-140 hover:bg-secondary"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {error ? (
        <ErrorState onClose={onClose} />
      ) : !doc ? (
        <LoadingState loading={isLoading} />
      ) : (
        <DocBody doc={doc} />
      )}
    </SlideOver>
  );
}

function DocBody({ doc }: { doc: LibraryDoc }) {
  const fresh = freshnessOf(doc.lastModifiedAt);
  return (
    <>
      <div className="flex-1 overflow-auto px-6 py-5">
        <h2 className="text-[18px] font-medium leading-title tracking-tight text-text-primary">
          {doc.title}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-text-faint">
          <span>{doc.source}</span>
          {doc.author ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{doc.author}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <FreshnessTag iso={doc.lastModifiedAt} fresh={fresh} />
          <span aria-hidden="true">·</span>
          <span>{doc.citationCount} cites</span>
        </div>

        {doc.body ? (
          <div className="mt-5 space-y-3 text-[13px] leading-body text-text-body">
            {doc.body.split('\n\n').map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : doc.snippet ? (
          <p className="mt-5 text-[13px] leading-body text-text-body">{doc.snippet}</p>
        ) : (
          <p className="mt-5 text-[13px] leading-body text-text-faint">
            The brain has no body for this doc yet.
          </p>
        )}

        {doc.tags.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {doc.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent"
              >
                #{t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button size="sm" variant="primary" className="gap-1.5">
          <Sparkles size={12} strokeWidth={1.5} />
          Ask brain about this
        </Button>
        {doc.sourceUrl ? (
          <Button size="sm" variant="secondary" className="gap-1.5" asChild>
            <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} strokeWidth={1.5} />
              Open in {doc.source}
            </a>
          </Button>
        ) : null}
      </div>
    </>
  );
}

function LoadingState({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <p
        aria-live="polite"
        className="font-mono text-xs text-text-subtle"
      >
        {loading ? 'Loading…' : ''}
      </p>
    </div>
  );
}

function ErrorState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-start gap-3 px-6 py-5">
      <p className="text-sm text-text-body">
        Couldn&rsquo;t load this document.
      </p>
      <button
        onClick={onClose}
        className="font-mono text-xs text-accent hover:underline"
      >
        Close
      </button>
    </div>
  );
}

function FreshnessTag({
  iso,
  fresh,
}: {
  iso: string;
  fresh: 'fresh' | 'aging' | 'stale';
}) {
  const label = formatRelative(iso);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        fresh === 'aging' && 'text-amber-700',
        fresh === 'stale' && 'text-destructive',
      )}
      title={fresh === 'fresh' ? '' : `Last updated ${label}`}
    >
      {fresh !== 'fresh' ? (
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            fresh === 'aging' ? 'bg-amber-500' : 'bg-destructive',
          )}
        />
      ) : null}
      {label}
    </span>
  );
}
