import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import useSWR from 'swr';
import { ArrowRight } from 'lucide-react';

import { QuickSwitcher } from '@/components/QuickSwitcher';
import { Sidebar } from '@/components/Sidebar';
import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { EmptyShelf } from '@/components/onboarding/illustrations/EmptyShelf';
import { PagesIntoBox } from '@/components/onboarding/illustrations/PagesIntoBox';
import { CurrentPayload, HomeState, deriveHomeState } from '@/lib/onboarding/derive';
import { formatRelative } from '@/lib/api';
import { EASE_ENTER, EASE_EXIT } from '@/lib/motion';

interface HomeWorkspace {
  id: string;
  name: string;
  runtime: 'pending' | 'ready' | 'failed';
  status?: string;
  plan?: string | null;
  gbrainReady?: boolean;
  createdAt?: string;
}

interface HomeConnection {
  id: string;
  kind: string;
  status: string;
  displayName?: string | null;
}

interface HomeLastJob {
  id: string;
  status: string;
  pagesTotal?: number | null;
  pagesIndexed?: number | null;
  recentPages?: string[] | null;
  etaSeconds?: number | null;
  createdAt?: string;
}

interface HomeCurrentPayload extends CurrentPayload {
  user: { id: string; email: string };
  workspace: HomeWorkspace | null;
  invites: Array<{ id: string; email: string; status: string }>;
  connections: HomeConnection[];
  lastJob: HomeLastJob | null;
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

export default function HomePage() {
  const router = useRouter();
  const [pollInterval, setPollInterval] = useState(0);
  const { data: current, error, mutate } = useSWR<HomeCurrentPayload>(
    '/api/workspaces/current',
    fetcher,
    { refreshInterval: pollInterval },
  );

  const state: HomeState | null = current ? deriveHomeState(current) : null;

  // Drive the SWR poll cadence from the derived state. Ingesting → 1s, otherwise no poll.
  useEffect(() => {
    setPollInterval(state?.kind === 'ingesting' ? 1000 : 0);
  }, [state?.kind]);

  // 401 → bounce to sign-in. redirect-onboard → /auth/onboard.
  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  useEffect(() => {
    if (state?.kind === 'redirect-onboard') {
      void router.replace('/auth/onboard');
    }
  }, [state, router]);

  return (
    <>
      <Head>
        <title>Home - Open42</title>
      </Head>
      <main className="min-h-screen bg-background">
        <AnimatePresence mode="wait" initial={false}>
          {state?.kind === 'ready' ? (
            <motion.div
              key="calm"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.32, ease: EASE_ENTER },
              }}
              exit={{ opacity: 0, transition: { duration: 0.2, ease: EASE_EXIT } }}
            >
              <CalmDashboard
                current={current as HomeCurrentPayload}
                hasError={state.hasError}
                mutate={mutate}
              />
            </motion.div>
          ) : state?.kind === 'empty' || state?.kind === 'ingesting' ? (
            <motion.div
              key={state.kind}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.32, ease: EASE_EXIT },
              }}
            >
              <EditorialDashboard
                kind={state.kind}
                current={current as HomeCurrentPayload}
                mutate={mutate}
              />
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
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
      <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
        <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
          <span className="h-[10px] w-[10px] rounded-full bg-accent" aria-hidden="true" />
          open42
        </span>
        <p
          className="mt-12 font-mono text-xs text-text-subtle"
          aria-live="polite"
        >
          {error && error.status !== 401
            ? 'Couldn\u2019t load your brain. Refresh to try again.'
            : 'Loading\u2026'}
        </p>
      </div>
      <div className="hidden bg-accent-soft md:block" />
    </div>
  );
}

/* ───────────────── Editorial layer (empty + ingesting) ───────────────── */

function EditorialDashboard({
  kind,
  current,
  mutate,
}: {
  kind: 'empty' | 'ingesting';
  current: HomeCurrentPayload;
  mutate: () => Promise<unknown>;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
      <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
        <TopBar workspace={current.workspace} kind={kind} />

        <div className="mt-12 flex flex-1 items-start md:mt-16">
          <div className="w-full max-w-[560px]">
            {kind === 'empty' ? (
              <EmptyHero mutate={mutate} />
            ) : (
              <IngestingHero current={current} />
            )}
          </div>
        </div>

        <BottomNote kind={kind} workspace={current.workspace} />
      </div>

      {kind === 'empty' ? (
        <EditorialPane
          quote={
            <>
              A library is just a building.
              <br />
              <em>The books are what matter.</em>
            </>
          }
          attribution="— OPEN42 OPERATING PRINCIPLE №3"
          illustration={<EmptyShelf />}
        />
      ) : (
        <EditorialPane
          quote={
            <>
              Some answers <em>take a moment.</em>
              <br />
              Most are worth the wait.
            </>
          }
          attribution="— OPEN42 OPERATING PRINCIPLE №4"
          illustration={<PagesIntoBox />}
        />
      )}
    </div>
  );
}

function TopBar({
  workspace,
  kind,
}: {
  workspace: HomeWorkspace | null;
  kind: 'empty' | 'ingesting';
}) {
  const stepLabel = kind === 'ingesting' ? 'Ingesting' : 'Ready';
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
        <span className="h-[10px] w-[10px] rounded-full bg-accent" aria-hidden="true" />
        open42
        {workspace?.name ? (
          <span className="text-text-subtle">&middot; {workspace.name}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-subtle">
        <span className="font-medium text-text-primary">{stepLabel}</span>
        <div className="flex items-center gap-1.5" aria-label="onboarding progress">
          <Dot done />
          <Connector done />
          <Dot done />
          <Connector done />
          <Dot active />
        </div>
      </div>
    </div>
  );
}

function Dot({ done, active }: { done?: boolean; active?: boolean }) {
  const cls = active
    ? 'bg-accent'
    : done
      ? 'bg-accent opacity-55'
      : 'bg-[#e5e5e5]';
  return (
    <span
      className={`h-[7px] w-[7px] rounded-full transition-colors duration-200 ${cls}`}
      aria-hidden="true"
    />
  );
}

function Connector({ done }: { done?: boolean }) {
  const cls = done ? 'bg-accent opacity-55' : 'bg-[#e5e5e5]';
  return <span className={`h-px w-[18px] ${cls}`} aria-hidden="true" />;
}

function EmptyHero({ mutate }: { mutate: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<'notion' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const connectNotion = useCallback(async () => {
    if (busy) return;
    setBusy('notion');
    setError(null);
    try {
      const response = await fetch('/api/connections/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ kind: 'notion-composio' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? 'connection_failed');
        setBusy(null);
        return;
      }
      const redirectUrl: string | undefined = payload.redirect_url ?? payload.redirectUrl;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      // No redirect required → refresh state.
      await mutate();
      setBusy(null);
    } catch {
      setError('network_error');
      setBusy(null);
    }
  }, [busy, mutate]);

  const onFilePick = useCallback(() => {
    if (busy) return;
    fileInputRef.current?.click();
  }, [busy]);

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // reset the input so picking the same file twice still triggers change
      if (event.target) event.target.value = '';
      if (!file || busy) return;
      setBusy('zip');
      setError(null);
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/connections/notion-zip', {
          method: 'POST',
          headers: { ...csrfHeaders() },
          body: form,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'upload_failed');
          setBusy(null);
          return;
        }
        await mutate();
        setBusy(null);
      } catch {
        setError('network_error');
        setBusy(null);
      }
    },
    [busy, mutate],
  );

  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.32, ease: EASE_ENTER },
      }}
    >
      <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        Your brain{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          is empty.
        </em>
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">
        It&rsquo;s waiting for something to remember. Drop in a source &mdash; we&rsquo;ll
        read it, index it, and cite it for every answer it produces.
      </p>

      <div className="mt-8 grid max-w-[520px] grid-cols-1 gap-3.5 sm:grid-cols-2">
        <SourceCard
          name="Connect Notion"
          sub="Live sync via OAuth. We'll keep your workspace fresh as pages change."
          tag="RECOMMENDED"
          tagAccent
          disabled={busy !== null}
          onClick={() => void connectNotion()}
          icon={
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 4 L13 4 M3 8 L13 8 M3 12 L9 12" />
            </svg>
          }
          loading={busy === 'notion'}
        />
        <SourceCard
          name="Upload Notion zip"
          sub="Drop in a workspace export. Faster, no OAuth — but no live sync."
          tag="FILE · ZIP"
          disabled={busy !== null}
          onClick={onFilePick}
          icon={
            <svg
              viewBox="0 0 16 16"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 2 L11 2 L13 4 L13 14 L4 14 Z M11 2 L11 4 L13 4" />
            </svg>
          }
          loading={busy === 'zip'}
        />
      </div>

      <ComingSoonSources />

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        hidden
        onChange={onFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {error ? (
        <p role="alert" className="mt-4 text-[13px] font-medium text-destructive">
          {humanizeError(error)}
        </p>
      ) : null}
    </motion.div>
  );
}

/**
 * Sources we don't yet support but want users to see on the empty state — so
 * the brain feels honest about its roadmap (PHILOSOPHY.md: "honest about what
 * it doesn't know") without overpromising. Tiles are inert and visually muted.
 */
const COMING_SOON_SOURCES: Array<{ name: string; monogram: string; eta: string }> = [
  { name: 'Google Drive', monogram: 'D', eta: 'Q3' },
  { name: 'Slack', monogram: 'S', eta: 'Q3' },
  { name: 'Gmail', monogram: 'G', eta: 'Q3' },
  { name: 'Confluence', monogram: 'C', eta: 'Q4' },
  { name: 'Linear', monogram: 'L', eta: 'Q4' },
  { name: 'GitHub', monogram: '⌥', eta: 'Q4' },
  { name: 'Box / Dropbox', monogram: 'B', eta: 'Q4' },
  { name: 'Markdown / files', monogram: 'M', eta: 'soon' },
];

function ComingSoonSources() {
  return (
    <section className="mt-7" aria-label="Sources coming soon">
      <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-text-faint">
        COMING SOON
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {COMING_SOON_SOURCES.map((s) => (
          <div
            key={s.name}
            aria-disabled="true"
            title={`${s.name} — ${s.eta}`}
            className="rounded-xl border border-border bg-white px-3 py-2.5 opacity-60"
          >
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted font-mono text-[10px] text-text-faint"
              >
                {s.monogram}
              </span>
              <span className="truncate text-[12px] text-text-faint">{s.name}</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-text-faint">
              {s.eta}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceCard({
  name,
  sub,
  tag,
  tagAccent,
  icon,
  onClick,
  disabled,
  loading,
}: {
  name: string;
  sub: string;
  tag: string;
  tagAccent?: boolean;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-[132px] flex-col justify-between rounded-xl border border-[#e5e5e5] bg-white p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:border-accent hover:shadow-[0_4px_14px_rgba(29,77,255,0.08)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent text-accent">
          {icon}
        </span>
        <p className="mt-3.5 text-sm font-medium text-text-primary">{name}</p>
        <p className="mt-1 text-xs leading-[1.5] text-text-subtle">{sub}</p>
      </div>
      <p
        className={`mt-2.5 font-mono text-[10px] tracking-[0.04em] ${
          tagAccent ? 'text-accent' : 'text-accent'
        }`}
      >
        {loading ? 'WORKING\u2026' : tag}
      </p>
    </button>
  );
}

function IngestingHero({ current }: { current: HomeCurrentPayload }) {
  const lastJob = current.lastJob;
  const connection = current.connections[0];

  const total = lastJob?.pagesTotal ?? null;
  const indexed = lastJob?.pagesIndexed ?? null;
  const pct = total && total > 0 && indexed != null
    ? Math.min(100, Math.max(0, Math.round((indexed / total) * 100)))
    : null;
  const indeterminate = pct === null;

  const sourceName =
    connection?.displayName ||
    (connection?.kind === 'notion-zip' ? 'Notion · ZIP' : 'Notion · Connected');

  const meta = pct !== null
    ? `${indexed} / ${total} pages \u00b7 ${pct}%`
    : lastJob?.status === 'queued'
      ? 'queued\u2026'
      : 'running\u2026';

  const recent = Array.isArray(lastJob?.recentPages) ? lastJob!.recentPages! : [];

  return (
    <motion.div
      key="ingesting"
      initial={{ opacity: 0, y: 4 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.32, ease: EASE_ENTER },
      }}
    >
      <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
        Reading{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          your team&rsquo;s notebook.
        </em>
      </h1>
      <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">
        You can close this tab. We&rsquo;ll keep going. When you come back, your brain
        will be ready.
      </p>

      <div className="mt-7 max-w-[560px] rounded-2xl border border-[#e5e5e5] bg-white p-[22px_24px]">
        <div className="flex items-center justify-between gap-3.5">
          <span className="flex items-center gap-2.5 text-sm font-medium text-text-primary">
            <span
              className="h-2 w-2 rounded-full bg-accent"
              style={{ animation: 'pulse 1.4s ease-in-out infinite' }}
              aria-hidden="true"
            />
            {sourceName}
          </span>
          <span className="font-mono text-[11px] text-text-subtle">{meta}</span>
        </div>

        <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-accent-soft">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-400"
            style={{ width: pct !== null ? `${pct}%` : '0%' }}
          />
          {indeterminate ? (
            <div
              className="pointer-events-none absolute left-0 top-0 h-full w-[60px] bg-gradient-to-r from-transparent via-white/65 to-transparent"
              style={{ animation: 'shimmer 1.6s linear infinite' }}
              aria-hidden="true"
            />
          ) : null}
        </div>

        <div className="mt-4 grid max-h-[120px] gap-1.5 overflow-hidden font-mono text-[11px] text-text-subtle">
          {recent.length > 0
            ? recent.slice(0, 5).map((line, idx) => (
                <div
                  key={`${line}-${idx}`}
                  className={`flex items-center gap-2.5 ${idx === 0 ? 'text-accent' : ''}`}
                >
                  <span className="text-accent">{'\u2713'}</span>
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

function BottomNote({
  kind,
  workspace,
}: {
  kind: 'empty' | 'ingesting';
  workspace: HomeWorkspace | null;
}) {
  const runtime = workspace?.runtime ?? 'pending';
  const text =
    kind === 'ingesting'
      ? 'ETA \u00b7 about 4 minutes'
      : runtime === 'ready'
        ? 'Brain runtime: ready'
        : runtime === 'failed'
          ? 'Brain runtime: failed \u2014 retrying\u2026'
          : 'Brain runtime: spinning up\u2026';

  return (
    <p className="mt-12 flex items-center gap-2 text-xs leading-[1.7] text-text-subtle">
      <span
        className="h-[7px] w-[7px] rounded-full bg-accent"
        style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
        aria-hidden="true"
      />
      {text}
    </p>
  );
}

/* ───────────────── Calm dashboard (ready) — ask-first landing ───────────────── */

const ASK_SUGGESTIONS = [
  'Refund policy',
  'Onboarding deck',
  'Hiring rubric',
  'Pricing',
];

function CalmDashboard({
  current,
  hasError,
  mutate,
}: {
  current: HomeCurrentPayload;
  hasError: boolean;
  mutate: () => Promise<unknown>;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col px-10 py-10">
        {hasError ? (
          <div className="mx-auto w-full max-w-4xl">
            <ErrorCard
              workspaceName={current.workspace?.name ?? ''}
              mutate={mutate}
            />
          </div>
        ) : null}
        <AskHero current={current} />
      </main>
      <QuickSwitcher />
    </div>
  );
}

function AskHero({ current }: { current: HomeCurrentPayload }) {
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
      void router.push({
        pathname: '/auth/chat',
        query: { q: trimmed },
      });
    },
    [query, router],
  );

  const statusLine =
    pages > 0
      ? `${pages.toLocaleString()} pages${lastImported ? ` · synced ${lastImported}` : ''}`
      : 'brain ready';

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center">
      <div
        className="absolute right-0 top-0 font-mono text-xs text-text-faint"
        aria-live="polite"
      >
        {statusLine}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_ENTER }}
        className="w-full max-w-[640px] text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.04em] text-text-subtle">
          ASK
        </p>
        <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
          Ask the brain.
        </h1>
        <p className="mt-3 text-sm leading-body text-text-body">
          Every answer cites its source.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 flex items-center gap-2 rounded-2xl border border-border bg-white px-5 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-140 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(29,77,255,0.12)]"
        >
          <span aria-hidden="true" className="font-mono text-accent">
            ▸
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What does the brain know about\u2026"
            className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-faint focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={!query.trim()}
            aria-label="Submit question"
            className="rounded-md p-1.5 text-text-faint transition-[color,background-color,transform] duration-140 hover:bg-secondary hover:text-text-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowRight size={16} strokeWidth={1.5} />
          </button>
        </form>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {ASK_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="rounded-full border border-border bg-white px-3 py-1 text-xs text-text-body transition-colors duration-140 hover:border-accent hover:text-accent"
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
      className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-destructive/20 bg-white p-5"
    >
      <div>
        <p className="text-sm font-medium text-text-primary">
          Brain runtime had a problem.
        </p>
        {error ? (
          <p className="mt-1 text-xs text-destructive">{humanizeError(error)}</p>
        ) : (
          <p className="mt-1 text-xs text-text-subtle">
            We can re-trigger provisioning. Your data is safe.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={retrying}
        className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-[13px] font-medium text-white transition-[filter,transform] duration-140 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
      >
        {retrying ? 'Retrying\u2026' : 'Retry'}
      </button>
    </div>
  );
}

/* ───────────────── helpers ───────────────── */

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
    case 'connection_failed':
      return 'Couldn\u2019t start the connection. Try again.';
    case 'upload_failed':
      return 'That zip didn\u2019t upload. Check the file and try again.';
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

