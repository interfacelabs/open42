import Head from 'next/head';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';

interface ConnectionsPayload {
  workspaceId: string | null;
}

interface IngestPayload {
  ingestMode: 'import_once' | 'periodic_pull';
  ingestIntervalHours: number;
  ingestLastCycleAt: string | null;
  lastJob: {
    id: string;
    status: string;
    pagesTotal: number;
    connectorsSummary: Array<{ connection_id: string; kind: string; pages: number; error?: string }>;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function IngestSettingsPage() {
  const { data: connections } = useSWR<ConnectionsPayload>('/api/connections', fetcher);
  const workspaceId = connections?.workspaceId ?? null;
  const { data, mutate } = useSWR<IngestPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/ingest` : null,
    fetcher,
    {
      refreshInterval: (latest) => (latest?.lastJob?.status === 'running' ? 1000 : 0),
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

  return (
    <>
      <Head>
        <title>Ingest - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <header className="flex items-center justify-between border-b border-border pb-5">
            <div>
              <Link href="/auth/settings/connections" className="font-mono text-sm text-text-subtle">
                Settings
              </Link>
              <h1 className="mt-4 text-2xl font-medium text-text-primary">Ingest</h1>
            </div>
            <Button size="sm" variant="secondary" onClick={syncNow} disabled={!workspaceId || data?.lastJob?.status === 'running'}>
              <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Sync
            </Button>
          </header>

          {!workspaceId ? (
            <div className="mt-8 border-y border-border py-12 text-sm text-text-subtle">
              Connect a source before changing ingest settings.
            </div>
          ) : data ? (
            <section className="mt-8 grid gap-8">
              <div className="grid gap-4 border-y border-border py-5">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={data.ingestMode === 'periodic_pull' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => patch({ ingestMode: 'periodic_pull' })}
                  >
                    Periodic sync
                  </Button>
                  <Button
                    variant={data.ingestMode === 'import_once' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => patch({ ingestMode: 'import_once' })}
                  >
                    Snapshot
                  </Button>
                </div>
                {data.ingestMode === 'periodic_pull' ? (
                  <select
                    className="h-10 max-w-44 rounded-input border border-input bg-white px-3 text-sm"
                    value={data.ingestIntervalHours}
                    onChange={(event) => patch({ ingestIntervalHours: Number(event.target.value) })}
                  >
                    {[1, 4, 12, 24].map((hours) => (
                      <option key={hours} value={hours}>
                        {hours}h
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="border-y border-border py-5">
                <h2 className="text-base font-medium text-text-primary">Last cycle</h2>
                {data.lastJob ? (
                  <div className="mt-4 grid gap-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-text-subtle">Status</span>
                      <span className="font-medium text-text-primary">{data.lastJob.status}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-text-subtle">Pages</span>
                      <span className="font-mono text-text-primary">{data.lastJob.pagesTotal}</span>
                    </div>
                    {data.lastJob.connectorsSummary.map((entry) => (
                      <div key={entry.connection_id} className="flex justify-between gap-4">
                        <span className="text-text-subtle">{entry.kind}</span>
                        <span className="font-mono text-text-primary">
                          {entry.error ?? `${entry.pages} pages`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-text-subtle">No cycles yet.</p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}

function csrfHeaders(): HeadersInit {
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}
