import Head from 'next/head';
import Link from 'next/link';
import { ChangeEvent, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'submitted'; jobId: string; pagesTotal: number }
  | { status: 'error'; message: string };

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function OnboardPage() {
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const jobId = state.status === 'submitted' ? state.jobId : null;
  const { data: job } = useSWR(jobId ? `/api/connectors/notion-zip/jobs/${jobId}` : null, fetcher, {
    refreshInterval: (latest) =>
      latest && ['completed', 'failed'].includes(latest.status) ? 0 : 1000,
  });
  const progress = useMemo(() => {
    const total = job?.pagesTotal ?? (state.status === 'submitted' ? state.pagesTotal : 0);
    const processed = job?.pagesProcessed ?? 0;
    return total > 0 ? Math.round((processed / total) * 100) : 0;
  }, [job, state]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setState({ status: 'uploading' });
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`${apiUrl()}/connectors/notion-zip`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders(),
      body: form,
    });
    const payload = await response.json();
    if (!response.ok) {
      setState({ status: 'error', message: payload.error ?? 'upload_failed' });
      return;
    }
    setState({ status: 'submitted', jobId: payload.jobId, pagesTotal: payload.pagesTotal });
  }

  return (
    <>
      <Head>
        <title>Import Notion - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-landing">
          <Link href="/auth/home" className="font-mono text-sm text-text-subtle">
            open42
          </Link>
          <section className="pt-20">
            <p className="font-mono text-xs text-text-subtle">NOTION ZIP</p>
            <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
              Import the docs. Let the brain work.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-body text-text-body">
              Drop a Notion HTML/Markdown export. Open42 normalizes pages, stages
              markdown, and submits a gbrain sync job in the background.
            </p>

            <label className="mt-10 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-white px-6 text-center transition-colors hover:border-input">
              <span className="text-sm font-medium text-text-primary">
                {state.status === 'uploading' ? 'Uploading' : 'Choose Notion zip'}
              </span>
              <span className="mt-2 text-sm text-text-subtle">Maximum 100MB</span>
              <input type="file" accept=".zip" className="sr-only" onChange={onFile} />
            </label>

            {state.status === 'submitted' ? (
              <div className="mt-8 rounded-2xl border border-border bg-white p-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text-primary">
                    {job?.status ?? 'submitted_to_gbrain'}
                  </span>
                  <span className="font-mono text-xs text-text-subtle">{progress}%</span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent transition-transform duration-200"
                    style={{ transform: `scaleX(${Math.max(progress, 4) / 100})`, transformOrigin: 'left' }}
                  />
                </div>
                <p className="mt-4 text-sm leading-body text-text-body">
                  You can close this tab. The home pane will show the imported pages
                  when processing completes.
                </p>
              </div>
            ) : null}

            {state.status === 'error' ? (
              <div className="mt-8 rounded-2xl border border-destructive/20 bg-white p-5">
                <p className="text-sm font-medium text-destructive">{state.message}</p>
                <p className="mt-2 text-sm leading-body text-text-body">
                  The import did not start. Check that your workspace has a ready
                  gbrain tenant and try again.
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}

function apiUrl() {
  return (process.env.NEXT_PUBLIC_API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function csrfHeaders(): HeadersInit {
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}
