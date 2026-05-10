import Head from 'next/head';
import { useRouter } from 'next/router';
import { ReactNode, useEffect } from 'react';
import { motion } from 'motion/react';
import useSWR from 'swr';

import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
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
  workspace: { id: string; name: string; runtime: 'pending' | 'ready' | 'failed' } | null;
  connections: StatusConnection[];
  lastJob: StatusLastJob | null;
}

/**
 * /auth/status — dedicated brain status page (S-B layout).
 *
 * Hero stats + recent events + connections list, all derived from
 * /api/workspaces/current. The 7-day ingest sparkline and the asks-counter
 * stay placeholders until the API exposes per-day history (TODO).
 */
export default function StatusPage() {
  const router = useRouter();
  const { data, error } = useSWR<StatusPayload, FetchError>(
    '/api/workspaces/current',
    fetcher,
  );

  useEffect(() => {
    if (error?.status === 401) void router.replace('/sign_in');
  }, [error, router]);

  useEffect(() => {
    if (data && !data.workspace) void router.replace('/auth/onboard');
  }, [data, router]);

  return (
    <>
      <Head>
        <title>Status — Open42</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 px-10 py-10">
          {data ? <StatusBody data={data} /> : <LoadingBody />}
        </div>
        <QuickSwitcher />
      </main>
    </>
  );
}

function StatusBody({ data }: { data: StatusPayload }) {
  const pages = data.lastJob?.pagesTotal ?? 0;
  const sources = data.connections.length;
  const lastSync = data.lastJob?.createdAt
    ? formatRelative(data.lastJob.createdAt)
    : 'never';
  const lastJobStatus = data.lastJob?.status;
  const hasIssue = lastJobStatus === 'failed';

  const heading = hasIssue
    ? 'Brain has an issue.'
    : pages > 0
      ? 'All systems healthy.'
      : 'Brain is empty.';

  const sub = hasIssue
    ? 'Last ingest failed. Check Settings → Connections.'
    : pages > 0
      ? `Last sync ${lastSync}.`
      : 'Connect a source to give the brain something to remember.';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_ENTER }}
      className="max-w-4xl"
    >
      <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
        BRAIN · STATUS
      </p>
      <h1 className="mt-3 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
        {heading}
      </h1>
      <p className="mt-2 text-sm leading-body text-text-subtle">{sub}</p>

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat label="Pages" value={pages > 0 ? String(pages) : '—'} />
        <Stat label="Sources" value={String(sources)} />
        <Stat label="Fresh" value={pages > 0 ? 'current' : 'empty'} />
        <Stat label="Asks · 7d" value="—" />
      </div>

      <Section title="Ingest jobs · last 7 days">
        <PlaceholderCard text="History will surface here once /api/workspaces/current exposes per-day job counts." />
      </Section>

      <Section title="Recent events">
        {data.lastJob ? (
          <div className="rounded-2xl border border-border bg-white">
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
          <div className="rounded-2xl border border-border bg-white">
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
  );
}

function LoadingBody() {
  return (
    <div className="max-w-4xl">
      <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
        BRAIN · STATUS
      </p>
      <p
        aria-live="polite"
        className="mt-12 font-mono text-xs text-text-subtle"
      >
        Loading…
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
        {label}
      </p>
      <p className="mt-3 text-2xl font-medium tracking-tight text-text-primary">
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PlaceholderCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-text-subtle">{text}</p>
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
    <div className="grid grid-cols-[100px_1fr_70px] items-center gap-3 px-5 py-4 text-sm">
      <span className="font-mono text-xs text-text-faint">{ago}</span>
      <span className="text-text-body">{label}</span>
      <span
        className={cn(
          'justify-self-end font-mono text-xs',
          ok ? 'text-[hsl(142_71%_29%)]' : 'text-destructive',
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
        'flex items-center gap-3 px-5 py-4',
        divider && 'border-b border-border',
      )}
    >
      <span
        className={cn('h-2 w-2 rounded-full', dotForStatus(connection.status))}
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-text-primary">
          {connection.displayName ?? sourceLabel(connection.kind)}
        </div>
        <div className="font-mono text-xs text-text-faint">
          {connection.kind} · {connection.status}
        </div>
      </div>
    </div>
  );
}

function dotForStatus(status: string): string {
  if (status === 'active' || status === 'completed') {
    return 'bg-[hsl(142_71%_45%)]';
  }
  if (status === 'errored' || status === 'failed' || status === 'disconnected') {
    return 'bg-destructive';
  }
  return 'bg-amber-500';
}
