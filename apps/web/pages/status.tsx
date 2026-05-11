import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect } from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';
import {
  ArrowUpRight,
  MessageSquare,
  Plug,
  RefreshCw,
  Upload,
} from 'lucide-react';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { fetcher, formatRelative, sourceLabel, type FetchError } from '@/lib/api';
import { EASE_ENTER } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface StatusConnection {
  id: string;
  kind: string;
  status: string;
  displayName?: string | null;
}

interface StatusLastJob {
  id: string;
  status: string;
  pagesTotal?: number | null;
  pagesIndexed?: number | null;
  createdAt?: string;
}

interface StatusPayload {
  workspace: {
    id: string;
    name: string;
    runtime: 'pending' | 'ready' | 'failed';
  } | null;
  connections: StatusConnection[];
  lastJob: StatusLastJob | null;
}

/**
 * /status — brain status surface.
 *
 * Reads /api/workspaces/current and presents it in the same cadence as the
 * right-rail UtilityPanel: live status card with progress bar, quick action
 * shortcuts, then the detailed retrospective sections (stats, events,
 * connections). The page exposes everything the UtilityPanel hints at, at
 * full page width.
 */
export default function StatusPage() {
  const router = useRouter();
  const { data, error } = useSWR<StatusPayload, FetchError>(
    '/api/workspaces/current',
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.lastJob?.status === 'running' ||
        latest?.lastJob?.status === 'queued'
          ? 1500
          : 0,
    },
  );

  useEffect(() => {
    if (error?.status === 401) void router.replace('/sign_in');
  }, [error, router]);

  useEffect(() => {
    if (data && !data.workspace) void router.replace('/onboard');
  }, [data, router]);

  return (
    <>
      <Head>
        <title>Status — Open42</title>
      </Head>
      <AppShell>
        {data ? <StatusBody data={data} /> : <LoadingBody />}
      </AppShell>
    </>
  );
}

function StatusBody({ data }: { data: StatusPayload }) {
  const live = deriveLive(data);
  const pages = data.lastJob?.pagesTotal ?? 0;
  const sources = data.connections.length;
  const lastSync = data.lastJob?.createdAt
    ? formatRelative(data.lastJob.createdAt)
    : 'never';

  const heading = live.kind === 'error' ? (
    <>
      Brain has an <span className="font-serif italic">issue.</span>
    </>
  ) : live.kind === 'indexing' ? (
    <>
      <span className="font-serif italic">Indexing</span> your sources.
    </>
  ) : pages > 0 ? (
    <>
      All systems <span className="font-serif italic">healthy.</span>
    </>
  ) : (
    <>
      Brain is <span className="font-serif italic">empty.</span>
    </>
  );

  const sub =
    live.kind === 'error'
      ? 'Last ingest failed. Check Settings → Connections.'
      : live.kind === 'indexing'
        ? 'You can keep working. We\u2019ll keep going.'
        : pages > 0
          ? `Last sync ${lastSync}.`
          : 'Connect a source to give the brain something to remember.';

  return (
    <>
      <PageHeader
        breadcrumb="BRAIN · STATUS"
        title={heading}
        subtitle={sub}
        size="lg"
      />
      <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_ENTER }}
          className="grid max-w-5xl gap-10"
        >
          <LiveStatusCard live={live} />

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <Stat
              label="Pages"
              value={pages > 0 ? pages.toLocaleString() : '—'}
            />
            <Stat label="Sources" value={String(sources)} />
            <Stat label="Fresh" value={pages > 0 ? 'current' : 'empty'} />
            <Stat label="Asks · 7d" value="—" hint="coming soon" />
          </div>

          <QuickActions empty={pages === 0} />

          <Section title="Recent events">
            {data.lastJob ? (
              <div className="overflow-hidden rounded-xl border border-border-soft bg-white">
                <EventRow
                  ago={
                    data.lastJob.createdAt
                      ? formatRelative(data.lastJob.createdAt)
                      : 'just now'
                  }
                  label={`Ingest · ${data.lastJob.status}`}
                  ok={data.lastJob.status !== 'failed'}
                />
              </div>
            ) : (
              <PlaceholderCard text="No events yet." />
            )}
          </Section>

          <Section title="Connections">
            {data.connections.length === 0 ? (
              <PlaceholderCard text="No sources connected. Visit Settings → Connections to add one." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border-soft bg-white">
                {data.connections.map((c, i) => (
                  <ConnectionRow
                    key={c.id}
                    connection={c}
                    divider={i !== data.connections.length - 1}
                  />
                ))}
              </div>
            )}
          </Section>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────── Live status card ─────────────────────── */

type Live =
  | { kind: 'empty' }
  | { kind: 'ready'; pages: number; lastSynced: string | null }
  | {
      kind: 'indexing';
      indexed: number | null;
      total: number | null;
      pct: number | null;
    }
  | { kind: 'error' };

function deriveLive(data: StatusPayload): Live {
  const job = data.lastJob;
  if (!job) {
    return { kind: 'empty' };
  }
  if (job.status === 'failed') return { kind: 'error' };
  if (job.status === 'running' || job.status === 'queued') {
    const total = job.pagesTotal ?? null;
    const indexed = job.pagesIndexed ?? null;
    const pct =
      total && total > 0 && indexed != null
        ? Math.min(100, Math.max(0, Math.round((indexed / total) * 100)))
        : null;
    return { kind: 'indexing', indexed, total, pct };
  }
  return {
    kind: 'ready',
    pages: job.pagesTotal ?? 0,
    lastSynced: job.createdAt ? formatRelative(job.createdAt) : null,
  };
}

function LiveStatusCard({ live }: { live: Live }) {
  const { dot, bar, label } = liveCardTokens(live);
  let pct: number | null = null;
  let indeterminate = false;
  if (live.kind === 'indexing') {
    pct = live.pct;
    indeterminate = pct === null;
  } else if (live.kind === 'ready') {
    pct = 100;
  } else if (live.kind === 'error') {
    pct = 100;
  } else {
    pct = 6;
  }
  return (
    <article className="rounded-xl border border-border-soft bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              dot,
              live.kind === 'indexing' && 'animate-pulse',
            )}
          />
          <p className="text-[14px] font-medium text-text-primary">{label}</p>
        </div>
        {live.kind === 'indexing' &&
        live.indexed != null &&
        live.total != null ? (
          <p className="font-mono text-[11px] text-text-subtle">
            {live.indexed.toLocaleString()} / {live.total.toLocaleString()} pages
            {live.pct != null ? ` · ${live.pct}%` : null}
          </p>
        ) : null}
      </div>
      <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-blue-soft">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            bar,
          )}
          style={{ width: `${pct ?? 0}%` }}
        />
        {indeterminate ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 h-full w-[60px] bg-gradient-to-r from-transparent via-white/75 to-transparent"
            style={{ animation: 'shimmer 1.6s linear infinite' }}
          />
        ) : null}
      </div>
    </article>
  );
}

function liveCardTokens(live: Live): {
  dot: string;
  bar: string;
  label: string;
} {
  switch (live.kind) {
    case 'indexing':
      return { dot: 'bg-blue', bar: 'bg-blue', label: 'Indexing…' };
    case 'ready':
      return { dot: 'bg-green', bar: 'bg-green', label: 'Brain ready' };
    case 'error':
      return {
        dot: 'bg-destructive',
        bar: 'bg-destructive',
        label: 'Last ingest failed',
      };
    case 'empty':
      return { dot: 'bg-text-faint', bar: 'bg-text-faint', label: 'No data yet' };
  }
}

/* ─────────────────────── Quick actions ─────────────────────── */

const ACTIONS: Array<{
  href: string;
  label: string;
  sub: string;
  icon: ReactNode;
}> = [
  {
    href: '/chat',
    label: 'Ask the brain',
    sub: 'Get a cited answer',
    icon: <MessageSquare size={15} strokeWidth={1.6} />,
  },
  {
    href: '/settings/ingest',
    label: 'Upload a source',
    sub: 'PDF, Notion, Drive…',
    icon: <Upload size={15} strokeWidth={1.6} />,
  },
  {
    href: '/settings/connections',
    label: 'Manage connections',
    sub: 'Tokens, scopes, refresh',
    icon: <Plug size={15} strokeWidth={1.6} />,
  },
];

function QuickActions({ empty }: { empty: boolean }) {
  return (
    <section>
      <SectionTitle>Quick actions</SectionTitle>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const highlight =
            empty && a.href === '/settings/connections/add';
          return (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                'group flex items-start gap-3 rounded-xl border bg-white p-4 transition-all duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card',
                highlight ? 'border-blue-line shadow-card' : 'border-border-soft',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-soft bg-panel-soft text-text-body group-hover:text-text-primary">
                {a.icon}
              </span>
              <span className="flex flex-1 flex-col">
                <span className="text-[13.5px] font-medium leading-tight text-text-primary">
                  {a.label}
                </span>
                <span className="mt-0.5 text-[12px] leading-tight text-text-subtle">
                  {a.sub}
                </span>
              </span>
              <ArrowUpRight
                size={13}
                strokeWidth={1.6}
                className="shrink-0 text-text-faint transition-colors group-hover:text-text-primary"
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────── Loading shell ─────────────────────── */

function LoadingBody() {
  return (
    <>
      <PageHeader
        breadcrumb="BRAIN · STATUS"
        title="Loading…"
        subtitle="Reading status."
        size="lg"
      />
      <div className="flex flex-1 items-center justify-center px-5 py-10 md:px-10">
        <span className="flex items-center gap-2 font-mono text-[11px] text-text-subtle">
          <RefreshCw size={12} className="animate-spin" strokeWidth={1.6} />
          fetching…
        </span>
      </div>
    </>
  );
}

/* ─────────────────────── Shared bits ─────────────────────── */

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-white p-5">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
        {label}
      </p>
      <p className="mt-3 text-[22px] font-medium tracking-tight text-text-primary">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 font-mono text-[10px] text-text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
      {children}
    </h2>
  );
}

function PlaceholderCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-white p-5">
      <p className="text-[13px] text-text-subtle">{text}</p>
    </div>
  );
}

function EventRow({
  ago,
  label,
  ok,
}: {
  ago: string;
  label: string;
  ok: boolean;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr_70px] items-center gap-3 px-5 py-3.5 text-[13px]">
      <span className="font-mono text-[11px] text-text-faint">{ago}</span>
      <span className="text-text-body">{label}</span>
      <span
        className={cn(
          'justify-self-end font-mono text-[11px]',
          ok ? 'text-green' : 'text-destructive',
        )}
      >
        {ok ? 'ok' : 'failed'}
      </span>
    </div>
  );
}

function ConnectionRow({
  connection,
  divider,
}: {
  connection: StatusConnection;
  divider: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-5 py-3.5',
        divider && 'border-b border-border-soft',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          dotForStatus(connection.status),
        )}
      />
      <div className="flex-1">
        <div className="text-[13.5px] font-medium text-text-primary">
          {connection.displayName ?? sourceLabel(connection.kind)}
        </div>
        <div className="font-mono text-[11px] text-text-faint">
          {connection.kind} · {connection.status}
        </div>
      </div>
    </div>
  );
}

function dotForStatus(status: string): string {
  if (status === 'active' || status === 'completed') return 'bg-green';
  if (status === 'errored' || status === 'failed' || status === 'disconnected') {
    return 'bg-destructive';
  }
  return 'bg-orange';
}
