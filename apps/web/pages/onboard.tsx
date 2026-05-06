import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChangeEvent, useEffect, useState } from 'react';
import { FileArchive, PlugZap } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';

interface ConnectionsPayload {
  workspaceId: string | null;
  connections: Array<{ id: string; kind: string; status: string }>;
}

interface IngestPayload {
  lastJob: { status: string; pagesTotal: number } | null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function OnboardPage() {
  const router = useRouter();
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'queued' | 'error'>('idle');
  const step = typeof router.query.step === 'string' ? router.query.step : 'connect';
  const { data: connections, mutate: mutateConnections } = useSWR<ConnectionsPayload>(
    '/api/connections',
    fetcher,
  );
  const workspaceId = connections?.workspaceId ?? null;
  const { data: ingest } = useSWR<IngestPayload>(
    step === 'ingesting' && workspaceId ? `/api/workspaces/${workspaceId}/ingest` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.lastJob && ['completed', 'failed'].includes(latest.lastJob.status) ? 0 : 1000,
    },
  );

  useEffect(() => {
    if (router.query.connected === 'notion') {
      void router.replace('/onboard?step=ingesting');
    }
  }, [router.query.connected, router]);

  useEffect(() => {
    if (step === 'ingesting' && ingest?.lastJob?.status === 'completed') {
      void router.push('/chat');
    }
  }, [ingest, router, step]);

  async function connectOAuth() {
    const response = await fetch('/api/connections/init', {
      method: 'POST',
      headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'notion-composio' }),
    });
    const payload = await response.json();
    if (response.ok && payload.redirect_url) window.location.href = payload.redirect_url;
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
    if (!response.ok) {
      setUploadState('error');
      return;
    }
    setUploadState('queued');
    await mutateConnections();
    void router.push('/onboard?step=ingesting');
  }

  return (
    <>
      <Head>
        <title>Connect Notion - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-landing">
          <Link href="/home" className="font-mono text-sm text-text-subtle">
            open42
          </Link>

          {step === 'ingesting' ? (
            <section className="pt-20">
              <p className="font-mono text-xs text-text-subtle">INGESTING</p>
              <h1 className="mt-4 text-4xl font-medium leading-headline text-text-primary md:text-5xl">
                Building the first brain.
              </h1>
              <div className="mt-10 border-y border-border py-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text-primary">
                    {ingest?.lastJob?.status ?? 'queued'}
                  </span>
                  <span className="font-mono text-xs text-text-subtle">
                    {ingest?.lastJob?.pagesTotal ?? 0} pages
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <section className="pt-20">
              <p className="font-mono text-xs text-text-subtle">NOTION</p>
              <h1 className="mt-4 text-4xl font-medium leading-headline text-text-primary md:text-5xl">
                Connect the first source.
              </h1>
              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="flex min-h-36 items-start justify-between border border-border bg-white p-5 text-left hover:border-input"
                  onClick={connectOAuth}
                >
                  <span>
                    <span className="block text-sm font-medium text-text-primary">
                      Connect Notion live
                    </span>
                    <span className="mt-2 block text-sm text-text-subtle">OAuth via Composio</span>
                  </span>
                  <PlugZap className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
                </button>
                <label className="flex min-h-36 cursor-pointer items-start justify-between border border-border bg-white p-5 text-left hover:border-input">
                  <span>
                    <span className="block text-sm font-medium text-text-primary">
                      Upload Notion export
                    </span>
                    <span className="mt-2 block text-sm text-text-subtle">
                      {uploadState === 'uploading'
                        ? 'Uploading'
                        : uploadState === 'queued'
                          ? 'Queued'
                          : 'Zip file'}
                    </span>
                  </span>
                  <FileArchive className="h-5 w-5 text-text-subtle" strokeWidth={1.5} />
                  <input type="file" accept=".zip" className="sr-only" onChange={uploadZip} />
                </label>
              </div>
              {uploadState === 'error' ? (
                <p className="mt-5 text-sm font-medium text-destructive">Upload failed</p>
              ) : null}
              <Button asChild variant="link" className="mt-8 px-0">
                <Link href="/chat">Skip</Link>
              </Button>
            </section>
          )}
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
