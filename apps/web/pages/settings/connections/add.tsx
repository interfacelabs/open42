import Head from 'next/head';
import Link from 'next/link';
import { ChangeEvent, useState } from 'react';
import { FileArchive, Github, PlugZap, X } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';

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
  const { data } = useSWR<ConnectionsPayload>('/api/connections', fetcher);
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const hasNotion = Boolean(
    data?.connections.some((connection) => connection.kind.startsWith('notion-') && connection.status !== 'disconnected'),
  );

  async function connectOAuth() {
    const response = await fetch('/api/connections/init', {
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
    if (!file) return;
    setUploadState('uploading');
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/connections/notion-zip', {
      method: 'POST',
      headers: csrfHeaders(),
      body: form,
    });
    setUploadState(response.ok ? 'done' : 'error');
  }

  return (
    <>
      <Head>
        <title>Add connection - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <header className="border-b border-border pb-5">
            <Link href="/settings/connections" className="font-mono text-sm text-text-subtle">
              Connections
            </Link>
            <h1 className="mt-4 text-2xl font-medium text-text-primary">Add connection</h1>
          </header>

          {hasNotion ? (
            <div className="mt-8 border-y border-border py-5 text-sm text-text-body">
              Notion is already connected. Disconnect it before switching ingestion methods.
            </div>
          ) : null}

          <section className="mt-8 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="flex min-h-32 items-start justify-between border border-border bg-white p-5 text-left transition-colors hover:border-input disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setModalOpen(true)}
              disabled={hasNotion}
            >
              <span>
                <span className="block text-sm font-medium text-text-primary">Notion</span>
                <span className="mt-2 block text-sm text-text-subtle">Live OAuth or zip import</span>
              </span>
              <PlugZap className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="flex min-h-32 cursor-not-allowed items-start justify-between border border-border bg-muted p-5 text-left opacity-70"
              disabled
            >
              <span>
                <span className="block text-sm font-medium text-text-primary">GitHub</span>
                <span className="mt-2 block text-sm text-text-subtle">Coming soon</span>
              </span>
              <Github className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
            </button>
          </section>
        </div>

        {modalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
            <div className="w-full max-w-lg rounded-lg border border-border bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium text-text-primary">Notion</h2>
                <Button variant="ghost" size="icon" onClick={() => setModalOpen(false)}>
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </div>
              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  className="flex items-center justify-between border border-border p-4 text-left hover:border-input"
                  onClick={connectOAuth}
                >
                  <span>
                    <span className="block text-sm font-medium text-text-primary">Connect live</span>
                    <span className="mt-1 block text-sm text-text-subtle">OAuth via Composio</span>
                  </span>
                  <PlugZap className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
                </button>
                <label className="flex cursor-pointer items-center justify-between border border-border p-4 text-left hover:border-input">
                  <span>
                    <span className="block text-sm font-medium text-text-primary">Upload zip</span>
                    <span className="mt-1 block text-sm text-text-subtle">
                      {uploadState === 'uploading' ? 'Uploading' : uploadState === 'done' ? 'Queued' : 'Notion export'}
                    </span>
                  </span>
                  <FileArchive className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
                  <input type="file" accept=".zip" className="sr-only" onChange={uploadZip} />
                </label>
              </div>
            </div>
          </div>
        ) : null}
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
