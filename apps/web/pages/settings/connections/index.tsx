import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { RefreshCw, Trash2, Plus, MoreHorizontal } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';

interface Connection {
  id: string;
  workspaceId: string;
  kind: 'notion-composio' | 'notion-zip';
  status: string;
  displayName: string;
  lastPulledAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface ConnectionsPayload {
  workspaceId: string | null;
  connections: Connection[];
}

export const getServerSideProps: GetServerSideProps<{
  initialData: ConnectionsPayload;
}> = async ({ req }) => {
  const response = await fetch(`${apiUrlServer()}/connections`, {
    headers: {
      Cookie: req.headers.cookie ?? '',
      'User-Agent': req.headers['user-agent'] ?? '',
    },
  }).catch(() => null);
  const initialData =
    response && response.ok
      ? ((await response.json()) as ConnectionsPayload)
      : { workspaceId: null, connections: [] };
  return { props: { initialData } };
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function ConnectionsPage({ initialData }: { initialData: ConnectionsPayload }) {
  const { data, mutate } = useSWR<ConnectionsPayload>('/api/connections', fetcher, {
    fallbackData: initialData,
  });
  const payload = data ?? initialData;

  async function disconnect(connection: Connection) {
    await mutate(
      {
        ...payload,
        connections: payload.connections.filter((item) => item.id !== connection.id),
      },
      false,
    );
    const response = await fetch(`/api/connections/${connection.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
    });
    if (!response.ok) await mutate();
  }

  async function syncNow() {
    if (!payload.workspaceId) return;
    await fetch(`/api/workspaces/${payload.workspaceId}/ingest/sync`, {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    await mutate();
  }

  return (
    <>
      <Head>
        <title>Connections - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <header className="flex items-center justify-between border-b border-border pb-5">
            <div>
              <Link href="/home" className="font-mono text-sm text-text-subtle">
                open42
              </Link>
              <h1 className="mt-4 text-2xl font-medium text-text-primary">Connections</h1>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/settings/connections/add">
                <Plus className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Add
              </Link>
            </Button>
          </header>

          <section className="mt-8">
            {payload.connections.length === 0 ? (
              <div className="border-y border-border py-16 text-center">
                <p className="text-sm font-medium text-text-primary">No connections</p>
                <p className="mt-2 text-sm text-text-subtle">Connect Notion to start ingestion.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-y border-border">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="text-xs uppercase text-text-subtle">
                    <tr className="border-b border-border">
                      <th className="py-3 font-medium">Service</th>
                      <th className="py-3 font-medium">Method</th>
                      <th className="py-3 font-medium">Status</th>
                      <th className="py-3 font-medium">Last pulled</th>
                      <th className="py-3 text-right font-medium">
                        <MoreHorizontal className="ml-auto h-4 w-4" strokeWidth={1.5} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.connections.map((connection) => (
                      <tr key={connection.id} className="border-b border-border last:border-0">
                        <td className="py-4 font-medium text-text-primary">
                          {connection.displayName}
                        </td>
                        <td className="py-4 text-text-body">{kindLabel(connection.kind)}</td>
                        <td className="py-4">
                          <span className={statusClass(connection.status)}>
                            {statusLabel(connection.status)}
                          </span>
                        </td>
                        <td className="py-4 font-mono text-xs text-text-subtle">
                          {connection.lastPulledAt
                            ? new Date(connection.lastPulledAt).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="py-4">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={syncNow}>
                              <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => disconnect(connection)}>
                              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function kindLabel(kind: Connection['kind']) {
  return kind === 'notion-composio' ? 'Live · Notion' : 'Upload · Notion';
}

function statusLabel(status: string) {
  if (status === 'pending_import') return 'Importing';
  if (status === 'active') return 'Synced';
  if (status === 'completed') return 'Imported';
  if (status === 'errored') return 'Reconnect';
  return status;
}

function statusClass(status: string) {
  const base = 'inline-flex rounded-full px-2 py-1 text-xs font-medium';
  if (status === 'pending_import') return `${base} bg-amber-50 text-amber-700`;
  if (status === 'errored') return `${base} bg-red-50 text-red-700`;
  if (status === 'active' || status === 'completed') return `${base} bg-emerald-50 text-emerald-700`;
  return `${base} bg-muted text-text-subtle`;
}

function csrfHeaders(): HeadersInit {
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function apiUrlServer() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
