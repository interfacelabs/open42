import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, GitBranch, Lock, RefreshCw, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { cn } from '@/lib/utils';

interface Repository {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

interface CurrentResponse {
  workspace?: { id: string } | null;
}

type PageState =
  | { kind: 'loading' }
  | {
      kind: 'selecting';
      workspaceId: string;
      stateToken: string;
      installationId: string;
      repos: Repository[];
    }
  | { kind: 'saving' }
  | { kind: 'done' }
  | {
      kind: 'error';
      code: string;
      configureUrl?: string | null;
      workspaceId?: string;
      stateToken?: string;
      installationId?: string;
    };

export default function GitHubCallbackPage() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!router.isReady || startedRef.current) return;
    startedRef.current = true;

    const stateToken = String(router.query.state ?? '');
    const installationId = String(router.query.installation_id ?? '');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (!stateToken || !installationId) {
      queueMicrotask(() => setPageState({ kind: 'error', code: 'missing_params' }));
      return;
    }

    let cancelled = false;
    void (async () => {
      let workspaceId = extractWorkspaceIdFromState(stateToken);
      if (!workspaceId) {
        const currentRes = await fetch('/api/workspaces/current').catch(() => null);
        const current =
          currentRes && currentRes.ok ? ((await currentRes.json()) as CurrentResponse) : null;
        workspaceId = current?.workspace?.id ?? null;
      }
      if (!workspaceId) throw new Error('no_workspace');
      const result = await finalizeInstallation({ workspaceId, stateToken, installationId });
      if (!cancelled) {
        if (result.kind === 'error') {
          setPageState({
            kind: 'error',
            code: result.code,
            configureUrl: result.configureUrl,
            workspaceId,
            stateToken,
            installationId,
          });
          return;
        }
        setSelectedIds(new Set(result.repos.slice(0, 3).map((repo) => repo.id)));
        setPageState({
          kind: 'selecting',
          workspaceId,
          stateToken,
          installationId,
          repos: result.repos,
        });
      }
    })().catch((err) => {
      if (!cancelled) setPageState({ kind: 'error', code: errorCode(err) });
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const selectedRepos = useMemo(() => {
    if (pageState.kind !== 'selecting') return [];
    return pageState.repos.filter((repo) => selectedIds.has(repo.id));
  }, [pageState, selectedIds]);

  async function saveSelection() {
    if (pageState.kind !== 'selecting' || selectedRepos.length === 0) return;
    setPageState({ kind: 'saving' });
    const response = await fetch(
      `/api/workspaces/${pageState.workspaceId}/connections/github/repos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          state: pageState.stateToken,
          installationId: pageState.installationId,
          repositories: selectedRepos.map((repo) => ({
            repoId: repo.id,
            owner: repo.owner,
            repo: repo.name,
            branch: repo.defaultBranch,
            pathFilters: [],
          })),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPageState({ kind: 'error', code: body.error ?? 'github_repo_save_failed' });
      return;
    }
    setPageState({ kind: 'done' });
    await router.replace('/');
  }

  async function retryFinalize() {
    if (
      pageState.kind !== 'error' ||
      !pageState.workspaceId ||
      !pageState.stateToken ||
      !pageState.installationId
    ) {
      return;
    }
    const { workspaceId, stateToken, installationId } = pageState;
    setPageState({ kind: 'loading' });
    const result = await finalizeInstallation({ workspaceId, stateToken, installationId }).catch(
      (err) => ({ kind: 'error' as const, code: errorCode(err), configureUrl: null }),
    );
    if (result.kind === 'error') {
      setPageState({
        kind: 'error',
        code: result.code,
        configureUrl: result.configureUrl,
        workspaceId,
        stateToken,
        installationId,
      });
      return;
    }
    setSelectedIds(new Set(result.repos.slice(0, 3).map((repo) => repo.id)));
    setPageState({
      kind: 'selecting',
      workspaceId,
      stateToken,
      installationId,
      repos: result.repos,
    });
  }

  return (
    <>
      <Head>
        <title>Connect GitHub - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-5 py-8 md:px-10 md:py-12">
        <div className="mx-auto max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-faint">
            GITHUB
          </p>
          <h1 className="mt-2 text-[32px] font-medium leading-tight text-text-primary">
            Choose repositories
          </h1>

          {pageState.kind === 'selecting' ? (
            <>
              <div className="mt-6 overflow-hidden rounded-xl border border-border-soft bg-white">
                {pageState.repos.map((repo, index) => {
                  const selected = selectedIds.has(repo.id);
                  return (
                    <label
                      key={repo.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors',
                        index > 0 && 'border-t border-border-soft',
                        selected && 'bg-blue-soft/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-blue"
                        checked={selected}
                        onChange={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(repo.id)) next.delete(repo.id);
                            else next.add(repo.id);
                            return next;
                          });
                        }}
                      />
                      {repo.private ? (
                        <Lock className="h-4 w-4 text-text-subtle" strokeWidth={1.5} />
                      ) : (
                        <Unlock className="h-4 w-4 text-text-subtle" strokeWidth={1.5} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-text-primary">
                          {repo.fullName}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-text-faint">
                          <GitBranch className="h-3 w-3" strokeWidth={1.5} />
                          {repo.defaultBranch}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <p className="text-[12.5px] text-text-subtle">{selectedRepos.length} selected</p>
                <Button onClick={() => void saveSelection()} disabled={selectedRepos.length === 0}>
                  Connect selected
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-8 rounded-xl border border-border-soft bg-white px-5 py-4">
              <p className="text-[13px] font-medium text-text-primary">{statusText(pageState)}</p>
              {pageState.kind === 'error' ? (
                <>
                  <p className="mt-2 text-[12.5px] leading-5 text-text-subtle">
                    {errorDetail(pageState)}
                  </p>
                  {pageState.code === 'github_selected_repositories_required' ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {pageState.configureUrl ? (
                        <Button asChild size="sm" variant="secondary">
                          <a href={pageState.configureUrl}>
                            Open GitHub settings
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </a>
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => void retryFinalize()}>
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Retry after selecting repos
                      </Button>
                    </div>
                  ) : isSessionMismatchError(pageState.code) ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button asChild size="sm">
                        <Link href="/sign_in">Sign in again</Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <Link href="/settings/connections/add">Start over</Link>
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
                      {pageState.code}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function statusText(state: PageState): string {
  if (state.kind === 'loading') return 'Loading repositories...';
  if (state.kind === 'saving') return 'Connecting repositories...';
  if (state.kind === 'done') return 'GitHub is connected.';
  if (state.kind === 'error' && state.code === 'github_selected_repositories_required') {
    return 'Select specific repositories in GitHub.';
  }
  if (state.kind === 'error' && isSessionMismatchError(state.code)) {
    return 'Sign in to the matching workspace.';
  }
  return 'GitHub connection failed.';
}

function errorDetail(state: Extract<PageState, { kind: 'error' }>): string {
  if (state.code === 'github_selected_repositories_required') {
    return 'Open42 requires selected repository access so it only syncs the docs you choose. Change the GitHub App access from all repositories to selected repositories, then retry here.';
  }
  if (isSessionMismatchError(state.code)) {
    return 'This GitHub install was started from a different Open42 session, workspace, or environment. On localhost, sign in to the same workspace that started the install, then start the GitHub connection again.';
  }
  return 'The GitHub callback could not be completed. Try reconnecting GitHub from workspace settings.';
}

function isSessionMismatchError(code: string): boolean {
  return code === 'workspace_membership_required' || code === 'unauthorized';
}

async function finalizeInstallation(input: {
  workspaceId: string;
  stateToken: string;
  installationId: string;
}): Promise<
  | { kind: 'selecting'; repos: Repository[] }
  | { kind: 'error'; code: string; configureUrl: string | null }
> {
  const response = await fetch(`/api/workspaces/${input.workspaceId}/connections/github/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      state: input.stateToken,
      installationId: input.installationId,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      kind: 'error',
      code: typeof body.error === 'string' ? body.error : 'github_finalize_failed',
      configureUrl: typeof body.configureUrl === 'string' ? body.configureUrl : null,
    };
  }
  const repos = Array.isArray(body.repositories) ? (body.repositories as Repository[]) : [];
  return { kind: 'selecting', repos };
}

export function extractWorkspaceIdFromState(stateToken: string): string | null {
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
  return err instanceof Error ? err.message : 'github_failed';
}
