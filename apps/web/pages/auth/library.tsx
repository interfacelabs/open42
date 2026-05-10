import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';

import { DocPanel } from '@/components/DocPanel';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { fetcher, formatRelative, sourceLabel, type FetchError } from '@/lib/api';
import {
  findCollection,
  freshnessOf,
  type LibraryDoc,
} from '@/lib/library-types';
import { EASE_ENTER } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface LibraryResponse {
  docs: LibraryDoc[];
  stub?: boolean;
}

interface CurrentResponse {
  workspace: { id: string; name: string } | null;
  connections: Array<{ id: string; kind: string; displayName?: string | null }>;
}

const SOURCE_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'notion', label: 'Notion' },
  { id: 'drive', label: 'Drive' },
];

export default function LibraryPage() {
  const router = useRouter();
  const collectionId = firstParam(router.query.c) ?? 'most-cited';
  const sourceFilterParam = firstParam(router.query.source);
  const docId = firstParam(router.query.doc);

  const collection = findCollection(collectionId);

  // Auth + onboarding gates mirror /auth/home + /auth/status.
  const { data: current, error: currentError } = useSWR<CurrentResponse, FetchError>(
    '/api/workspaces/current',
    fetcher,
  );
  useEffect(() => {
    if (currentError?.status === 401) void router.replace('/sign_in');
  }, [currentError, router]);
  useEffect(() => {
    if (current && !current.workspace) void router.replace('/auth/onboard');
  }, [current, router]);

  // Library data is keyed off the URL. SWR caches per query string.
  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilterParam) {
      params.set('source', sourceFilterParam);
    } else {
      params.set('collection', collectionId);
    }
    return `/api/library?${params.toString()}`;
  }, [collectionId, sourceFilterParam]);

  const { data, isLoading } = useSWR<LibraryResponse>(queryKey, fetcher);

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const docs = useMemo(() => {
    if (!data?.docs) return [];
    if (activeFilter === 'all') return data.docs;
    return data.docs.filter((d) => d.source === activeFilter);
  }, [data, activeFilter]);

  const openDoc = useCallback(
    (id: string) => {
      void router.push({ query: { ...router.query, doc: id } }, undefined, {
        shallow: true,
      });
    },
    [router],
  );

  const closeDoc = useCallback(() => {
    const next = { ...router.query };
    delete next.doc;
    void router.push({ query: next }, undefined, { shallow: true });
  }, [router]);

  const headerTitle = sourceFilterParam
    ? sourceLabel(sourceFilterParam)
    : (collection?.name ?? 'Library');
  const headerSub = sourceFilterParam
    ? `Browse all docs imported from ${sourceLabel(sourceFilterParam)}.`
    : (collection?.description ?? '');

  const titlePrefix = `Library · ${headerTitle}`;

  return (
    <>
      <Head>
        <title>{`${titlePrefix} — Open42`}</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="border-b border-border px-10 pb-6 pt-10">
            <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
              LIBRARY {sourceFilterParam ? '· SOURCES' : '· CURATED'}
            </p>
            <h1 className="mt-3 text-3xl font-medium leading-headline tracking-tight text-text-primary md:text-4xl">
              {headerTitle}
            </h1>
            {headerSub ? (
              <p className="mt-1.5 text-sm leading-body text-text-subtle">
                {headerSub}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {SOURCE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors duration-140',
                    activeFilter === f.id
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border bg-white text-text-body hover:border-accent/40 hover:text-text-primary',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>

          <div className="flex-1 overflow-auto px-10 py-8">
            {isLoading ? (
              <p
                aria-live="polite"
                className="font-mono text-xs text-text-subtle"
              >
                Loading…
              </p>
            ) : docs.length === 0 ? (
              <EmptyState
                hasFilter={activeFilter !== 'all' || !!sourceFilterParam}
                onClearFilter={() => setActiveFilter('all')}
              />
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease: EASE_ENTER }}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                {docs.map((doc) => (
                  <DocCard key={doc.id} doc={doc} onOpen={openDoc} />
                ))}
              </motion.div>
            )}
          </div>
        </div>

        <DocPanel docId={docId ?? null} onClose={closeDoc} />
        <QuickSwitcher />
      </main>
    </>
  );
}

function DocCard({
  doc,
  onOpen,
}: {
  doc: LibraryDoc;
  onOpen: (id: string) => void;
}) {
  const fresh = freshnessOf(doc.lastModifiedAt);
  return (
    <button
      type="button"
      onClick={() => onOpen(doc.id)}
      className="group flex flex-col rounded-2xl border border-border bg-white px-5 py-4 text-left transition-[border-color,box-shadow] duration-140 hover:border-accent/40 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <span className="text-[14px] font-medium leading-snug tracking-[-0.01em] text-text-primary">
        {doc.title}
      </span>
      {doc.snippet ? (
        <span className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-subtle">
          {doc.snippet}
        </span>
      ) : null}
      <span className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-text-faint">
        <span className="flex items-center gap-1.5">
          <span>{doc.source}</span>
          <span aria-hidden="true">·</span>
          <FreshnessLabel iso={doc.lastModifiedAt} fresh={fresh} />
        </span>
        <span className="text-accent">{doc.citationCount} cites</span>
      </span>
    </button>
  );
}

function FreshnessLabel({
  iso,
  fresh,
}: {
  iso: string;
  fresh: 'fresh' | 'aging' | 'stale';
}) {
  return (
    <span
      className={cn(
        fresh === 'aging' && 'text-amber-700',
        fresh === 'stale' && 'text-destructive',
      )}
    >
      {formatRelative(iso)}
    </span>
  );
}

function EmptyState({
  hasFilter,
  onClearFilter,
}: {
  hasFilter: boolean;
  onClearFilter: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
        EMPTY
      </p>
      <p className="mt-3 text-base text-text-primary">
        I don&rsquo;t have anything matching this view.
      </p>
      <p className="mt-1 text-sm text-text-subtle">
        {hasFilter
          ? 'Loosen the filter, or pick a different collection from the sidebar.'
          : 'Connect a source to give the brain something to remember.'}
      </p>
      {hasFilter ? (
        <button
          type="button"
          onClick={onClearFilter}
          className="mt-4 font-mono text-xs text-accent hover:underline"
        >
          Clear filter
        </button>
      ) : null}
    </div>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
