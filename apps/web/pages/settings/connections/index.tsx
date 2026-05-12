import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { HorizonGlyph } from '@/components/HorizonGlyph';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { connectionKindToSlug, providerLogo } from '@/lib/provider-logos';
import { cn } from '@/lib/utils';

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

interface CurrentResponse {
  workspace?: { id: string } | null;
}

export const getServerSideProps: GetServerSideProps<{
  initialData: ConnectionsPayload;
}> = async ({ req }) => {
  // Two round-trips: first resolve the caller's workspace from /workspaces/current,
  // then list connections under that workspace. The connections route now lives
  // under /workspaces/:id/connections (gated by requireMembership).
  const forwardHeaders = {
    Cookie: req.headers.cookie ?? '',
    'User-Agent': req.headers['user-agent'] ?? '',
  };
  const currentRes = await fetch(`${apiUrlServer()}/workspaces/current`, {
    headers: forwardHeaders,
  }).catch(() => null);
  const current =
    currentRes && currentRes.ok ? ((await currentRes.json()) as CurrentResponse) : null;
  const workspaceId = current?.workspace?.id ?? null;
  if (!workspaceId) {
    return { props: { initialData: { workspaceId: null, connections: [] } } };
  }
  const response = await fetch(
    `${apiUrlServer()}/workspaces/${encodeURIComponent(workspaceId)}/connections`,
    { headers: forwardHeaders },
  ).catch(() => null);
  const initialData =
    response && response.ok
      ? ((await response.json()) as ConnectionsPayload)
      : { workspaceId, connections: [] };
  return { props: { initialData } };
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function ConnectionsPage({
  initialData,
}: {
  initialData: ConnectionsPayload;
}) {
  const workspaceId = initialData.workspaceId;
  const { data, mutate } = useSWR<ConnectionsPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/connections` : null,
    fetcher,
    {
      fallbackData: initialData,
    },
  );
  const payload = data ?? initialData;

  async function disconnect(connection: Connection) {
    if (!workspaceId) return;
    await mutate(
      {
        ...payload,
        connections: payload.connections.filter(
          (item) => item.id !== connection.id,
        ),
      },
      false,
    );
    const response = await fetch(
      `/api/workspaces/${workspaceId}/connections/${connection.id}`,
      {
        method: 'DELETE',
        headers: csrfHeaders(),
      },
    );
    if (!response.ok) {
      await mutate();
    }
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
        <title>Connections — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · CONNECTIONS"
          title="Connections"
          subtitle="Sources the brain is allowed to read. Connect Notion, Drive, and more."
          actions={
            <Button asChild size="sm">
              <Link href="/settings/connections/add">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.6} />
                Add
              </Link>
            </Button>
          }
        />
        <SettingsNav active="connections" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          {payload.connections.length === 0 ? (
            <div className="flex min-h-[60vh] items-center justify-center">
              <EmptyState />
            </div>
          ) : (
            <div className="max-w-4xl">
              <div className="overflow-hidden rounded-xl border border-border-soft bg-white">
                <table className="w-full border-collapse text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border-soft bg-panel-soft">
                      <Th>Service</Th>
                      <Th>Method</Th>
                      <Th>Status</Th>
                      <Th>Last pulled</Th>
                      <Th align="right">{'\u00a0'}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.connections.map((connection, i) => {
                      const logo = providerLogo(
                        connectionKindToSlug(connection.kind),
                      );
                      const last = i === payload.connections.length - 1;
                      return (
                        <tr
                          key={connection.id}
                          className={cn(
                            !last && 'border-b border-border-soft',
                            'transition-colors hover:bg-panel-soft/50',
                          )}
                        >
                          <Td>
                            <span className="flex items-center gap-2.5">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt=""
                                  aria-hidden="true"
                                  width={20}
                                  height={20}
                                  className="h-5 w-5 rounded"
                                  loading="lazy"
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="inline-block h-5 w-5 rounded bg-panel-soft"
                                />
                              )}
                              <span className="font-medium text-text-primary">
                                {connection.displayName}
                              </span>
                            </span>
                          </Td>
                          <Td className="text-text-body">
                            {kindLabel(connection.kind)}
                          </Td>
                          <Td>
                            <StatusPill status={connection.status} />
                          </Td>
                          <Td className="font-mono text-[11.5px] text-text-subtle">
                            {connection.lastPulledAt
                              ? new Date(
                                  connection.lastPulledAt,
                                ).toLocaleString()
                              : 'Never'}
                          </Td>
                          <Td align="right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={syncNow}
                                title="Sync now"
                                aria-label="Sync now"
                              >
                                <RefreshCw
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.6}
                                />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => disconnect(connection)}
                                title="Disconnect"
                                aria-label="Disconnect"
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.6}
                                />
                              </Button>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'right';
}) {
  return (
    <th
      className={cn(
        'px-5 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-faint',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  align,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'right';
}) {
  return (
    <td
      className={cn(
        'px-5 py-3.5',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </td>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'green' | 'blue' | 'orange' | 'red' | 'neutral' }> = {
    active: { label: 'Synced', tone: 'green' },
    completed: { label: 'Imported', tone: 'green' },
    pending_import: { label: 'Importing', tone: 'blue' },
    errored: { label: 'Reconnect', tone: 'red' },
  };
  const entry = map[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]',
        entry.tone === 'green' && 'bg-blue-soft text-blue',
        entry.tone === 'blue' && 'bg-blue-soft text-blue',
        entry.tone === 'orange' && 'bg-orange-soft text-orange',
        entry.tone === 'red' && 'bg-destructive/10 text-destructive',
        entry.tone === 'neutral' && 'bg-panel-soft text-text-subtle',
      )}
    >
      {entry.label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-6 py-12 text-center md:py-16">
      <HorizonGlyph size={160} />
      <h3 className="mt-2 text-[16px] font-medium text-text-primary">
        No sources yet.
      </h3>
      <p className="mt-1.5 max-w-[42ch] text-[13.5px] text-text-subtle">
        Connect Notion, Drive, or upload a zip to give the brain something{' '}
        <span className="font-serif italic">to remember.</span>
      </p>
      <Link href="/settings/connections/add" className="btn-primary mt-6">
        Connect a source
      </Link>
    </div>
  );
}

function kindLabel(kind: Connection['kind']) {
  return kind === 'notion-composio' ? 'Live · Notion' : 'Upload · Notion';
}

function apiUrlServer() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );
}
