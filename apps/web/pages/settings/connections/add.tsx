import Head from 'next/head';
import { ChangeEvent, useState } from 'react';
import { FileArchive, PlugZap, X } from 'lucide-react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { providerLogo } from '@/lib/provider-logos';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

interface Connection {
  id: string;
  kind: string;
  status: string;
}

interface ConnectionsPayload {
  connections: Connection[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AddConnectionPage() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useSWR<ConnectionsPayload>(
    workspaceId ? `/api/workspaces/${workspaceId}/connections` : null,
    fetcher,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadState, setUploadState] = useState<
    'idle' | 'uploading' | 'done' | 'error'
  >('idle');
  const hasNotion = Boolean(
    data?.connections.some(
      (connection) =>
        connection.kind.startsWith('notion-') &&
        connection.status !== 'disconnected',
    ),
  );

  async function connectOAuth() {
    if (!workspaceId) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/connections/init`, {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'notion-composio' }),
    });
    const payload = await response.json();
    if (response.ok && payload.redirect_url) {
      window.location.href = payload.redirect_url;
    }
  }

  async function uploadZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !workspaceId) return;
    setUploadState('uploading');
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`/api/workspaces/${workspaceId}/connections/notion-zip`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: form,
    });
    setUploadState(response.ok ? 'done' : 'error');
  }

  return (
    <>
      <Head>
        <title>Add connection — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · CONNECTIONS · ADD"
          title="Add a connection"
          subtitle={
            <>
              Pick a source the brain should read.{' '}
              <span className="font-serif italic">It can wait.</span>
            </>
          }
        />
        <SettingsNav active="connections" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-4xl">
            {hasNotion ? (
              <div className="mb-6 rounded-xl border border-orange/30 bg-orange-soft px-5 py-4 text-[13px] text-text-body">
                Notion is already connected. Disconnect it before switching
                ingestion methods.
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2">
              <ProviderTile
                name="Notion"
                detail="Live OAuth or zip import"
                slug="notion"
                disabled={hasNotion}
                onClick={() => setModalOpen(true)}
              />
              <ProviderTile
                name="GitHub"
                detail="Coming soon"
                slug="github"
                disabled
                comingSoon
              />
              <ProviderTile
                name="Google Drive"
                detail="Coming soon"
                slug="drive"
                disabled
                comingSoon
              />
              <ProviderTile
                name="Slack"
                detail="Coming soon"
                slug="slack"
                disabled
                comingSoon
              />
            </section>
          </div>
        </div>

        {modalOpen ? (
          <NotionModal
            onClose={() => setModalOpen(false)}
            onOAuth={connectOAuth}
            uploadState={uploadState}
            onUpload={uploadZip}
          />
        ) : null}
      </AppShell>
    </>
  );
}

function ProviderTile({
  name,
  detail,
  slug,
  disabled,
  comingSoon,
  onClick,
}: {
  name: string;
  detail: string;
  slug: string;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  const src = providerLogo(slug);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-32 items-start justify-between rounded-xl border bg-white p-5 text-left transition-all duration-140',
        disabled
          ? 'cursor-not-allowed border-border-soft opacity-60'
          : 'border-border-soft hover:-translate-y-px hover:border-blue-line hover:shadow-card',
      )}
    >
      <span className="flex flex-col">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-text-primary">
            {name}
          </span>
          {comingSoon ? (
            <span className="rounded-full bg-panel-soft px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">
              Soon
            </span>
          ) : null}
        </span>
        <span className="mt-2 block text-[12.5px] text-text-subtle">
          {detail}
        </span>
      </span>
      {src ? (
        <img
          src={src}
          alt={`${name} logo`}
          width={20}
          height={20}
          className="h-5 w-5"
          loading="lazy"
        />
      ) : (
        <span className="h-5 w-5 rounded bg-panel-soft" />
      )}
    </button>
  );
}

function NotionModal({
  onClose,
  onOAuth,
  uploadState,
  onUpload,
}: {
  onClose: () => void;
  onOAuth: () => void;
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/15 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border-soft bg-white p-6 shadow-elevate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
              CONNECT · NOTION
            </p>
            <h2 className="mt-1 text-[18px] font-medium text-text-primary">
              How would you like to{' '}
              <span className="font-serif italic">share it?</span>
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={1.6} />
          </Button>
        </div>
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            className="flex items-center justify-between rounded-xl border border-border-soft p-4 text-left transition-all duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card"
            onClick={onOAuth}
          >
            <span>
              <span className="block text-[14px] font-medium text-text-primary">
                Connect live
              </span>
              <span className="mt-0.5 block text-[12.5px] text-text-subtle">
                OAuth via Composio · keeps in sync
              </span>
            </span>
            <PlugZap className="h-5 w-5 text-blue" strokeWidth={1.6} />
          </button>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border-soft p-4 text-left transition-all duration-140 hover:-translate-y-px hover:border-blue-line hover:shadow-card">
            <span>
              <span className="block text-[14px] font-medium text-text-primary">
                Upload zip
              </span>
              <span className="mt-0.5 block text-[12.5px] text-text-subtle">
                {uploadState === 'uploading'
                  ? 'Uploading…'
                  : uploadState === 'done'
                    ? 'Queued for indexing'
                    : uploadState === 'error'
                      ? 'Upload failed — try again'
                      : 'Notion export · one-time snapshot'}
              </span>
            </span>
            <FileArchive
              className="h-5 w-5 text-text-subtle"
              strokeWidth={1.6}
            />
            <input
              type="file"
              accept=".zip"
              className="sr-only"
              onChange={onUpload}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

