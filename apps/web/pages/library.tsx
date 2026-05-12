import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';
import { Search } from 'lucide-react';

import { DocPanel } from '@/components/DocPanel';
import { HorizonGlyph } from '@/components/HorizonGlyph';
import { MobileNavTrigger } from '@/components/MobileNavTrigger';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { UtilityPanel } from '@/components/UtilityPanel';
import { UtilityPanelToggle } from '@/components/UtilityPanelToggle';
import { fetcher, formatRelative, sourceLabel, type FetchError } from '@/lib/api';
import {
  findCollection,
  freshnessOf,
  type LibraryDoc,
} from '@/lib/library-types';
import { EASE_ENTER } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

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

  const { data: current, error: currentError } = useSWR<CurrentResponse, FetchError>(
    '/api/workspaces/current',
    fetcher,
  );
  useEffect(() => {
    if (currentError?.status === 401) void router.replace('/sign_in');
  }, [currentError, router]);
  useEffect(() => {
    if (current && !current.workspace) void router.replace('/onboard');
  }, [current, router]);

  // Library data is keyed off the URL + the current workspace id. The API is
  // mounted at `/workspaces/:id/library` so the workspace id rides in the path
  // and `requireMembership` enforces access. Without a workspace id the SWR
  // key is null and the panel sits idle.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryKey = useMemo(() => {
    if (!workspaceId) return null;
    const params = new URLSearchParams();
    if (sourceFilterParam) {
      params.set('source', sourceFilterParam);
    } else {
      params.set('collection', collectionId);
    }
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/library?${params.toString()}`;
  }, [collectionId, sourceFilterParam, workspaceId]);

  const { data, isLoading } = useSWR<LibraryResponse>(queryKey, fetcher);

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const docs = useMemo(() => {
    if (!data?.docs) return [];
    let next = data.docs;
    if (activeFilter !== 'all') {
      next = next.filter((d) => d.source === activeFilter);
    }
    const term = search.trim().toLowerCase();
    if (term) {
      next = next.filter(
        (d) =>
          d.title.toLowerCase().includes(term) ||
          (d.snippet?.toLowerCase().includes(term) ?? false),
      );
    }
    return next;
  }, [data, activeFilter, search]);

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
  const breadcrumbTrail = sourceFilterParam
    ? 'LIBRARY · SOURCES'
    : 'LIBRARY · CURATED';

  const titlePrefix = `Library · ${headerTitle}`;

  return (
    <>
      <Head>
        <title>{`${titlePrefix} — Open42`}</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            breadcrumb={breadcrumbTrail}
            title={headerTitle}
            search={search}
            onSearch={setSearch}
          />

          <div className="border-b border-border-soft px-5 pb-4 pt-3 md:px-10 md:pb-5 md:pt-5">
            {headerSub ? (
              <p className="max-w-[64ch] pb-4 text-[13.5px] leading-body text-text-subtle">
                {headerSub}
              </p>
            ) : null}
            <SegmentedTabs
              options={SOURCE_FILTERS}
              value={activeFilter}
              onChange={setActiveFilter}
            />
          </div>

          <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
            {isLoading ? (
              <p
                aria-live="polite"
                className="font-mono text-xs text-text-subtle"
              >
                Loading…
              </p>
            ) : docs.length === 0 ? (
              <div className="flex min-h-[60vh] items-center justify-center">
                <EmptyState
                  hasFilter={
                    activeFilter !== 'all' || !!sourceFilterParam || !!search
                  }
                  onClearFilter={() => {
                    setActiveFilter('all');
                    setSearch('');
                  }}
                />
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
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

        <UtilityPanel />
        <UtilityPanelToggle />

        <DocPanel docId={docId ?? null} onClose={closeDoc} />
        <QuickSwitcher />
      </main>
    </>
  );
}

/* ───────────────────────── Top bar ───────────────────────── */

function TopBar({
  breadcrumb,
  title,
  search,
  onSearch,
}: {
  breadcrumb: string;
  title: string;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 px-5 pb-4 pt-5 md:gap-6 md:px-10 md:pb-5 md:pt-7">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MobileNavTrigger className="mt-0.5" />
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
            {breadcrumb}
          </p>
          <h1 className="mt-1.5 truncate text-[20px] font-medium leading-tight tracking-tight text-text-primary md:mt-2 md:text-[26px]">
            {title}
          </h1>
        </div>
      </div>
      <div className="hidden md:block">
        <SearchBox value={search} onChange={onSearch} />
      </div>
    </header>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="group flex h-9 w-[260px] items-center gap-2 rounded-lg border border-border bg-white px-3 transition-colors duration-140 focus-within:border-blue-line focus-within:shadow-[0_0_0_3px_rgba(37,87,255,0.08)]">
      <Search size={14} strokeWidth={1.6} className="shrink-0 text-text-faint" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search docs"
        className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none"
      />
      <kbd className="hidden font-mono text-[10px] text-text-faint sm:inline">
        ⌘K
      </kbd>
    </label>
  );
}

/* ───────────────────────── Segmented tabs ───────────────────────── */

function SegmentedTabs({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-panel-soft p-1">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={cn(
              'rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors duration-140',
              active
                ? 'bg-white text-text-primary shadow-card'
                : 'text-text-subtle hover:text-text-primary',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Doc card ───────────────────────── */

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
      className="group flex flex-col rounded-xl border border-border-soft bg-white px-5 py-4 text-left transition-[border-color,box-shadow,transform] duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card"
    >
      <span className="text-[14px] font-medium leading-snug tracking-[-0.005em] text-text-primary">
        {doc.title}
      </span>
      {doc.snippet ? (
        <span className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-text-subtle">
          {doc.snippet}
        </span>
      ) : null}
      <span className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-text-faint">
        <span className="flex items-center gap-1.5">
          <span>{doc.source}</span>
          <span aria-hidden="true">·</span>
          <FreshnessLabel iso={doc.lastModifiedAt} fresh={fresh} />
        </span>
        <span className="text-blue">{doc.citationCount} cites</span>
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
        fresh === 'aging' && 'text-orange',
        fresh === 'stale' && 'text-destructive',
      )}
    >
      {formatRelative(iso)}
    </span>
  );
}

/* ───────────────────────── Empty state ───────────────────────── */

function EmptyState({
  hasFilter,
  onClearFilter,
}: {
  hasFilter: boolean;
  onClearFilter: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_ENTER }}
      className="mx-auto flex max-w-[640px] flex-col items-center px-6 py-8 text-center"
    >
      <HorizonGlyph size={180} />
      <h2 className="mt-2 text-[18px] font-medium leading-tight tracking-tight text-text-primary">
        This view is empty.
      </h2>
      <p className="mt-2 max-w-[42ch] text-[13.5px] leading-relaxed text-text-subtle">
        {hasFilter ? (
          <>
            Nothing matches this filter yet. Loosen the filter, or pick a
            different collection from the sidebar.
          </>
        ) : (
          <>
            Connect a source to give the brain something{' '}
            <span className="font-serif italic">to remember.</span>
          </>
        )}
      </p>
      <div className="mt-6">
        {hasFilter ? (
          <button
            type="button"
            onClick={onClearFilter}
            className="btn-secondary"
          >
            Clear filter
          </button>
        ) : (
          <a
            href="/settings/connections/add"
            className="btn-primary"
          >
            Connect a source
          </a>
        )}
      </div>
    </motion.div>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
