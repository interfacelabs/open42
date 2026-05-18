import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

import { csrfHeaders } from '@/lib/csrf';

interface CurrentResponse {
  workspace?: { id: string } | null;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'redirecting' }
  | { kind: 'error'; code: string };

export default function GitHubAppCallbackPage() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    if (!router.isReady || startedRef.current) return;
    startedRef.current = true;

    const code = String(router.query.code ?? '');
    const stateToken = String(router.query.state ?? '');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (!code || !stateToken) {
      queueMicrotask(() => setPageState({ kind: 'error', code: 'missing_params' }));
      return;
    }

    let cancelled = false;
    void (async () => {
      let workspaceId = extractWorkspaceIdFromState(stateToken);
      if (!workspaceId) {
        const currentRes = await fetch('/api/workspaces/current').catch(() => null);
        const current =
          currentRes && currentRes.ok
            ? ((await currentRes.json()) as CurrentResponse)
            : null;
        workspaceId = current?.workspace?.id ?? null;
      }
      if (!workspaceId) throw new Error('no_workspace');

      const response = await fetch(
        `/api/workspaces/${workspaceId}/connections/github/app-manifest/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ code, state: stateToken }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'github_app_finalize_failed');
      const redirectUrl: string | undefined = body.redirect_url ?? body.redirectUrl;
      if (!redirectUrl) throw new Error('github_install_redirect_missing');
      if (!cancelled) setPageState({ kind: 'redirecting' });
      window.location.href = redirectUrl;
    })().catch((err) => {
      if (!cancelled) setPageState({ kind: 'error', code: errorCode(err) });
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <>
      <Head>
        <title>Set up GitHub - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-5 py-8 md:px-10 md:py-12">
        <div className="mx-auto max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-faint">
            GITHUB
          </p>
          <h1 className="mt-2 text-[32px] font-medium leading-tight text-text-primary">
            Finishing setup
          </h1>
          <div className="mt-8 rounded-xl border border-border-soft bg-white px-5 py-4">
            <p className="text-[13px] font-medium text-text-primary">
              {statusText(pageState)}
            </p>
            {pageState.kind === 'error' ? (
              <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
                {pageState.code}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

function statusText(state: PageState): string {
  if (state.kind === 'redirecting') return 'Opening GitHub install...';
  if (state.kind === 'error') return 'GitHub setup failed.';
  return 'Saving GitHub App settings...';
}

function extractWorkspaceIdFromState(stateToken: string): string | null {
  const parts = stateToken.split('.');
  if (parts.length !== 2) return null;
  const [b64] = parts as [string, string];
  if (!b64) return null;
  try {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = atob(padded + '='.repeat(padLen));
    const payload = JSON.parse(json) as { workspaceId?: unknown };
    return typeof payload.workspaceId === 'string' ? payload.workspaceId : null;
  } catch {
    return null;
  }
}

function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : 'github_app_failed';
}
