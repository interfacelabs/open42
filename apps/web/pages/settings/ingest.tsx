import Head from 'next/head';
import { RefreshCw } from 'lucide-react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { HorizonGlyph } from '@/components/HorizonGlyph';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

interface IngestPayload {
  ingestMode: 'import_once' | 'periodic_pull';
  ingestIntervalHours: number;
  ingestLastCycleAt: string | null;
  lastJob: {
    id: string;
    status: string;
    pagesTotal: number;
    connectorsSummary: Array<{
      connection_id: string;
      kind: string;
      pages: number;
      error?: string;
    }>;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function IngestSettingsPage() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data, mutate } = useSWR<IngestPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/ingest` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.lastJob?.status === 'running' ? 1000 : 0,
    },
  );

  async function patch(next: Partial<IngestPayload>) {
    if (!workspaceId || !data) return;
    await mutate({ ...data, ...next }, false);
    await fetch(`/api/workspaces/${workspaceId}/ingest`, {
      method: 'PATCH',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingestMode: next.ingestMode ?? data.ingestMode,
        ingestIntervalHours: next.ingestIntervalHours ?? data.ingestIntervalHours,
      }),
    });
    await mutate();
  }

  async function syncNow() {
    if (!workspaceId) return;
    await fetch(`/api/workspaces/${workspaceId}/ingest/sync`, {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    await mutate();
  }

  const running = data?.lastJob?.status === 'running';

  return (
    <>
      <Head>
        <title>Ingest — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · INGEST"
          title="Ingest"
          subtitle={
            <>
              How and when the brain reads{' '}
              <span className="font-serif italic">your sources.</span>
            </>
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={syncNow}
              disabled={!workspaceId || running}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', running && 'animate-spin')}
                strokeWidth={1.6}
              />
              {running ? 'Syncing…' : 'Sync now'}
            </Button>
          }
        />
        <SettingsNav active="ingest" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          {!workspaceId ? (
            <div className="flex min-h-[60vh] items-center justify-center">
              <EmptyState />
            </div>
          ) : (
            <div className="max-w-3xl">
              {data ? (
              <div className="space-y-10">
                <section>
                  <SectionHeading>Mode</SectionHeading>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ModeChoice
                      active={data.ingestMode === 'periodic_pull'}
                      onClick={() => patch({ ingestMode: 'periodic_pull' })}
                      title="Periodic sync"
                      detail="Refresh every N hours"
                    />
                    <ModeChoice
                      active={data.ingestMode === 'import_once'}
                      onClick={() => patch({ ingestMode: 'import_once' })}
                      title="Snapshot"
                      detail="Import once, then stop"
                    />
                  </div>

                  {data.ingestMode === 'periodic_pull' ? (
                    <div className="mt-4">
                      <label className="block">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
                          Interval
                        </span>
                        <select
                          className="mt-1.5 h-10 w-44 rounded-lg border border-border bg-white px-3 text-[14px] text-text-primary focus:border-blue-line focus:outline-none focus:ring-[3px] focus:ring-blue-soft"
                          value={data.ingestIntervalHours}
                          onChange={(event) =>
                            patch({
                              ingestIntervalHours: Number(event.target.value),
                            })
                          }
                        >
                          {[1, 4, 12, 24].map((hours) => (
                            <option key={hours} value={hours}>
                              every {hours}h
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </section>

                <section>
                  <SectionHeading>Last cycle</SectionHeading>
                  {data.lastJob ? (
                    <article className="mt-3 rounded-xl border border-border-soft bg-white p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5">
                          <StatusDot status={data.lastJob.status} />
                          <p className="text-[14px] font-medium text-text-primary">
                            {jobStatusLabel(data.lastJob.status)}
                          </p>
                        </div>
                        <p className="font-mono text-[11px] text-text-subtle">
                          {data.lastJob.pagesTotal} pages
                        </p>
                      </div>
                      {data.lastJob.connectorsSummary.length > 0 ? (
                        <ul className="mt-4 space-y-2 border-t border-border-soft pt-4 text-[13px]">
                          {data.lastJob.connectorsSummary.map((entry) => (
                            <li
                              key={entry.connection_id}
                              className="flex items-center justify-between gap-4"
                            >
                              <span className="text-text-subtle">{entry.kind}</span>
                              <span
                                className={cn(
                                  'font-mono text-[12px]',
                                  entry.error
                                    ? 'text-destructive'
                                    : 'text-text-primary',
                                )}
                              >
                                {entry.error ?? `${entry.pages} pages`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ) : (
                    <article className="mt-3 rounded-xl border border-border-soft bg-white p-5">
                      <p className="text-[13.5px] text-text-subtle">
                        No cycles yet.
                      </p>
                    </article>
                  )}
                </section>
              </div>
              ) : null}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
      {children}
    </h2>
  );
}

function ModeChoice({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-w-[200px] flex-col rounded-xl border bg-white p-4 text-left transition-colors duration-140',
        active
          ? 'border-blue-line bg-blue-soft/40 shadow-card'
          : 'border-border-soft hover:border-blue-line',
      )}
    >
      <span
        className={cn(
          'text-[13.5px] font-medium',
          active ? 'text-blue' : 'text-text-primary',
        )}
      >
        {title}
      </span>
      <span className="mt-0.5 text-[12px] text-text-subtle">{detail}</span>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'failed'
      ? 'bg-destructive'
      : status === 'running' || status === 'queued'
        ? 'bg-blue'
        : 'bg-green';
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-1.5 w-1.5 rounded-full', tone)}
    />
  );
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return 'Indexing…';
    case 'queued':
      return 'Queued';
    case 'completed':
      return 'Complete';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-6 py-8 text-center">
      <HorizonGlyph size={160} />
      <h3 className="mt-2 text-[16px] font-medium text-text-primary">
        Nothing to ingest yet.
      </h3>
      <p className="mt-1.5 max-w-[42ch] text-[13.5px] text-text-subtle">
        Connect a source first, then come back to set how often the brain reads it.
      </p>
      <a href="/settings/connections/add" className="btn-primary mt-6">
        Connect a source
      </a>
    </div>
  );
}

