/**
 * Authenticated dashboard at `/`.
 *
 * Routing contract:
 *   - 401 from /api/workspaces/current → redirect to /sign_in
 *   - No workspace OR workspace.runtime !== 'ready' → redirect to /onboard
 *     (the onboard page's derive picks the correct sub-step)
 *   - Otherwise → render the dashboard. Two states:
 *       * an ingest job is queued/running → IngestingHero with progress
 *       * else → CalmDashboard (Sidebar + AskHero + UtilityPanel)
 *
 * The "connect a source" empty state used to live here. It moved into the
 * onboarding flow as the final step (/onboard?step=connect) — so by
 * the time a user lands here, either they've connected something or they
 * explicitly skipped, and either way the chat surface is the right thing
 * to render. New sources are added later via Settings → Connections.
 */
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import useSWR from 'swr';
import { ArrowRight } from 'lucide-react';

import { MobileNavTrigger } from '@/components/MobileNavTrigger';
import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { UtilityPanel } from '@/components/UtilityPanel';
import { UtilityPanelToggle } from '@/components/UtilityPanelToggle';
import {
  CurrentPayload,
  DashboardState,
  WorkspaceRuntime,
  deriveDashboardState,
} from '@/lib/onboarding/derive';
import { formatRelative } from '@/lib/api';
import { EASE_ENTER, EASE_EXIT } from '@/lib/motion';

interface DashboardWorkspace {
  id: string;
  name: string;
  runtime: WorkspaceRuntime;
  status?: string;
  plan?: string | null;
  gbrainReady?: boolean;
  createdAt?: string;
}

interface DashboardConnection {
  id: string;
  kind: string;
  status: string;
  displayName?: string | null;
}

interface DashboardLastJob {
  id: string;
  status: string;
  pagesTotal?: number | null;
  pagesIndexed?: number | null;
  recentPages?: string[] | null;
  etaSeconds?: number | null;
  createdAt?: string;
}

interface DashboardCurrentPayload extends CurrentPayload {
  user: { id: string; email: string };
  workspace: DashboardWorkspace | null;
  invites: Array<{ id: string; email: string; status: string }>;
  connections: DashboardConnection[];
  lastJob: DashboardLastJob | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

export default function DashboardPage() {
  const router = useRouter();
  const [pollInterval, setPollInterval] = useState(0);
  const { data: current, error, mutate, isValidating } = useSWR<DashboardCurrentPayload>(
    '/api/workspaces/current',
    fetcher,
    { refreshInterval: pollInterval },
  );

  const state: DashboardState | null = current ? deriveDashboardState(current) : null;

  useEffect(() => {
    setPollInterval(state?.kind === 'ingesting' ? 1000 : 0);
  }, [state?.kind]);

  useEffect(() => {
    if (isValidating) return;
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, isValidating, router]);

  useEffect(() => {
    if (state?.kind === 'redirect-onboard') {
      void router.replace('/onboard');
    }
  }, [state, router]);

  return (
    <>
      <Head>
        <title>Open42</title>
      </Head>
      <main className="min-h-screen bg-background">
        <AnimatePresence mode="wait" initial={false}>
          {state?.kind === 'ready' ? (
            <motion.div
              key="calm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.32, ease: EASE_ENTER } }}
              exit={{ opacity: 0, transition: { duration: 0.2, ease: EASE_EXIT } }}
            >
              <CalmDashboard
                current={current as DashboardCurrentPayload}
                hasError={state.hasError}
                mutate={mutate}
              />
            </motion.div>
          ) : state?.kind === 'ingesting' ? (
            <motion.div
              key="ingesting"
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.32, ease: EASE_EXIT } }}
            >
              <IngestingShell current={current as DashboardCurrentPayload} />
            </motion.div>
          ) : (
            <motion.div key="loading" initial={false} animate={{ opacity: 1 }}>
              <LoadingShell error={error as { status?: number } | null} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}

function LoadingShell({ error }: { error: { status?: number } | null }) {
  return (
    <div className="flex min-h-screen flex-col px-6 py-8 md:px-16 md:py-12">
      <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
        <span className="h-[10px] w-[10px] rounded-full bg-blue" aria-hidden="true" />
        open42
      </span>
      <p className="mt-12 font-mono text-xs text-text-subtle" aria-live="polite">
        {error && error.status !== 401
          ? 'Couldn\u2019t load your brain. Refresh to try again.'
          : 'Loading\u2026'}
      </p>
    </div>
  );
}

/* ───────────────── Ingesting hero (during initial import) ───────────────── */

function IngestingShell({ current }: { current: DashboardCurrentPayload }) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
      <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
        <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
          <span className="h-[10px] w-[10px] rounded-full bg-blue" aria-hidden="true" />
          open42
          {current.workspace?.name ? (
            <span className="text-text-subtle">&middot; {current.workspace.name}</span>
          ) : null}
        </span>

        <div className="mt-12 flex flex-1 items-start md:mt-16">
          <div className="w-full max-w-[560px]">
            <IngestingHero current={current} />
          </div>
        </div>
      </div>
      <div className="hidden bg-panel-blue md:block" />
    </div>
  );
}

function IngestingHero({ current }: { current: DashboardCurrentPayload }) {
  const lastJob = current.lastJob;
  const connection = current.connections[0];

  const total = lastJob?.pagesTotal ?? null;
  const indexed = lastJob?.pagesIndexed ?? null;
  const pct =
    total && total > 0 && indexed != null
      ? Math.min(100, Math.max(0, Math.round((indexed / total) * 100)))
      : null;
  const indeterminate = pct === null;

  const sourceName =
    connection?.displayName ||
    (connection?.kind === 'notion-zip' ? 'Notion · ZIP' : 'Notion · Connected');

  const meta =
    pct !== null
      ? `${indexed} / ${total} pages \u00b7 ${pct}%`
      : lastJob?.status === 'queued'
        ? 'queued\u2026'
        : 'running\u2026';

  const recent = Array.isArray(lastJob?.recentPages) ? lastJob!.recentPages! : [];

  return (
    <motion.div
      key="ingesting"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_ENTER } }}
    >
      <h1 className="text-[40px] font-medium leading-[1.04] tracking-[-0.025em] text-text-primary">
        Reading{' '}
        <span className="font-serif font-normal italic text-text-primary">
          your team&rsquo;s notebook.
        </span>
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-[14px] leading-body text-text-body">
        You can close this tab. We&rsquo;ll keep going. When you come back, your brain
        will be ready.
      </p>

      <div className="mt-8 max-w-[560px] rounded-xl border border-border-soft bg-white p-6">
        <div className="flex items-center justify-between gap-3.5">
          <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-text-primary">
            <span
              className="h-1.5 w-1.5 rounded-full bg-blue"
              style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
              aria-hidden="true"
            />
            {sourceName}
          </span>
          <span className="font-mono text-[10.5px] text-text-subtle">{meta}</span>
        </div>

        <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-blue-soft">
          <div
            className="h-full rounded-full bg-blue transition-[width] duration-500"
            style={{ width: pct !== null ? `${pct}%` : '0%' }}
          />
          {indeterminate ? (
            <div
              className="pointer-events-none absolute left-0 top-0 h-full w-[60px] bg-gradient-to-r from-transparent via-white/75 to-transparent"
              style={{ animation: 'shimmer 1.6s linear infinite' }}
              aria-hidden="true"
            />
          ) : null}
        </div>

        <div className="mt-4 grid max-h-[120px] gap-1.5 overflow-hidden font-mono text-[10.5px] text-text-subtle">
          {recent.length > 0
            ? recent.slice(0, 5).map((line, idx) => (
                <div
                  key={`${line}-${idx}`}
                  className={`flex items-center gap-2.5 ${idx === 0 ? 'text-blue' : ''}`}
                >
                  <span className="text-blue">{'\u2713'}</span>
                  {line}
                </div>
              ))
            : Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="flex items-center gap-2.5">
                  <span className="opacity-50">{'\u00b7'}</span>
                  indexing&hellip;
                </div>
              ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────────── Calm dashboard (ready) — ask-first landing ───────────────── */

const ASK_SUGGESTIONS = ['Refund policy', 'Onboarding deck', 'Hiring rubric', 'Pricing'];

function CalmDashboard({
  current,
  hasError,
  mutate,
}: {
  current: DashboardCurrentPayload;
  hasError: boolean;
  mutate: () => Promise<unknown>;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <TopBar workspaceName={current.workspace?.name ?? ''} />
        {hasError ? (
          <div className="px-5 pt-6 md:px-10">
            <ErrorCard workspaceName={current.workspace?.name ?? ''} mutate={mutate} />
          </div>
        ) : null}
        <AskHero current={current} />
      </main>
      <UtilityPanel />
      <UtilityPanelToggle />
      <QuickSwitcher />
    </div>
  );
}

function TopBar({ workspaceName }: { workspaceName: string }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border-soft px-5 py-5 md:gap-6 md:px-10 md:py-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MobileNavTrigger className="mt-0.5" />
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
            DASHBOARD
          </p>
          <h1 className="mt-1.5 truncate text-[20px] font-medium leading-tight tracking-tight text-text-primary md:mt-2 md:text-[22px]">
            {workspaceName ? workspaceName : 'Your brain'}
          </h1>
        </div>
      </div>
    </header>
  );
}

function AskHero({ current }: { current: DashboardCurrentPayload }) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const pages = current.lastJob?.pagesTotal ?? 0;
  const lastImported = current.lastJob?.createdAt
    ? formatRelative(current.lastJob.createdAt)
    : null;

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      void router.push({ pathname: '/chat', query: { q: trimmed } });
    },
    [query, router],
  );

  const statusLine =
    pages > 0
      ? `${pages.toLocaleString()} pages${lastImported ? ` \u00b7 synced ${lastImported}` : ''}`
      : null;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-10 md:px-10 md:py-12">
      {statusLine ? (
        <div
          className="absolute right-5 top-5 font-mono text-[10.5px] text-text-faint md:right-10 md:top-6"
          aria-live="polite"
        >
          {statusLine}
        </div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_ENTER }}
        className="w-full max-w-[640px] text-center"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-subtle">
          ASK
        </p>
        <h1 className="mt-4 text-[44px] font-medium leading-[1.04] tracking-[-0.025em] text-text-primary md:text-[52px]">
          Ask the{' '}
          <span className="font-serif font-normal italic">brain.</span>
        </h1>
        <p className="mt-3 text-[14px] leading-body text-text-body">
          Every answer cites its source.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3.5 text-left transition-[border-color,box-shadow] duration-140 focus-within:border-blue-line focus-within:shadow-[0_0_0_3px_rgba(37,87,255,0.10)]"
        >
          <span aria-hidden="true" className="font-mono text-blue">
            ▸
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={'What does the brain know about\u2026'}
            className="flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-faint focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={!query.trim()}
            aria-label="Submit question"
            className="rounded-md p-1.5 text-text-faint transition-[color,background-color,transform] duration-140 hover:bg-panel-soft hover:text-text-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowRight size={16} strokeWidth={1.6} />
          </button>
        </form>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {ASK_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="rounded-full border border-border-soft bg-white px-3 py-1 text-[11.5px] text-text-body transition-colors duration-140 hover:border-blue-line hover:text-blue"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ErrorCard({
  workspaceName,
  mutate,
}: {
  workspaceName: string;
  mutate: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRetry = useCallback(async () => {
    if (retrying || !workspaceName) return;
    setRetrying(true);
    setError(null);
    try {
      const response = await fetch('/api/workspaces/onboarding/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ name: workspaceName }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? 'retry_failed');
        setRetrying(false);
        return;
      }
      await mutate();
      setRetrying(false);
    } catch {
      setError('network_error');
      setRetrying(false);
    }
  }, [retrying, workspaceName, mutate]);

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-white p-5"
    >
      <div>
        <p className="text-[13.5px] font-medium text-text-primary">
          Brain runtime had a problem.
        </p>
        {error ? (
          <p className="mt-1 text-[12px] text-destructive">{humanizeError(error)}</p>
        ) : (
          <p className="mt-1 text-[12px] text-text-subtle">
            We can re-trigger provisioning. Your data is safe.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={retrying}
        className="btn-primary h-9 px-4 text-[13px]"
      >
        {retrying ? 'Retrying\u2026' : 'Retry'}
      </button>
    </div>
  );
}

function csrfHeaders(): HeadersInit {
  if (typeof document === 'undefined') return {};
  const csrf = document.cookie
    .split('; ')
    .find((part) => part.startsWith('open42_csrf='))
    ?.split('=')[1];
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function humanizeError(code: string): string {
  switch (code) {
    case 'retry_failed':
      return 'Retry didn\u2019t go through. Try again in a moment.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'network_error':
      return 'Couldn\u2019t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
