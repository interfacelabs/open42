/**
 * Final onboarding step — pick a source to seed the brain with.
 *
 * Used to live on / as the "empty" state. Lifted into the onboarding
 * flow so the post-onboarding dashboard at `/` doesn't have to switch UIs
 * based on whether the user has connected a source yet.
 *
 * The user can pick a source (kicks an OAuth or zip-upload flow) or hit
 * "Skip for now" — both paths push to `/`. The dashboard handles the
 * "no sources yet" case gracefully (chat just has nothing to cite).
 */
import { useRouter } from 'next/router';
import {
  ChangeEvent,
  ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

import { EASE_ENTER } from '@/lib/motion';
import type { WorkspaceRuntime } from '@/lib/onboarding/derive';
import { providerLogo } from '@/lib/provider-logos';

const COMING_SOON_SOURCES: Array<{
  name: string;
  slug: string | null;
  monogram: string;
  eta: string;
}> = [
  { name: 'Google Drive', slug: 'googledrive', monogram: 'D', eta: 'Q3' },
  { name: 'Slack', slug: 'slack', monogram: 'S', eta: 'Q3' },
  { name: 'Gmail', slug: 'gmail', monogram: 'G', eta: 'Q3' },
  { name: 'Confluence', slug: 'confluence', monogram: 'C', eta: 'Q4' },
  { name: 'Linear', slug: 'linear', monogram: 'L', eta: 'Q4' },
  { name: 'GitHub', slug: 'github', monogram: '⌥', eta: 'Q4' },
  { name: 'Box / Dropbox', slug: 'dropbox', monogram: 'B', eta: 'Q4' },
  { name: 'Markdown / files', slug: null, monogram: 'M', eta: 'soon' },
];

interface ConnectSourcesStepProps {
  runtime: WorkspaceRuntime;
  mutate: () => Promise<unknown>;
}

export function ConnectSourcesStep({ runtime, mutate }: ConnectSourcesStepProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'notion' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The provisioning step gates entry on runtime===ready, but we still defend
  // here in case of a race (user deep-links to ?step=connect before runtime
  // flips). The API also rejects with 425 in that case — see
  // /connections/{init,notion-zip}.
  const ready = runtime === 'ready';
  const blocked = !ready;
  const blockedReason = !ready
    ? runtime === 'failed'
      ? 'Brain runtime hasn\u2019t finished provisioning. Go back and retry before connecting a source.'
      : 'Still spinning up your brain runtime. We\u2019ll unlock these in a moment.'
    : null;

  const connectNotion = useCallback(async () => {
    if (busy || blocked) return;
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
      // No redirect needed (composio already had an active connection) — the
      // dashboard will pick it up.
      await mutate();
      void router.push('/');
    } catch {
      setError('network_error');
      setBusy(null);
    }
  }, [busy, blocked, mutate, router]);

  const onFilePick = useCallback(() => {
    if (busy || blocked) return;
    fileInputRef.current?.click();
  }, [busy, blocked]);

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so picking the same file twice still triggers change.
      if (event.target) event.target.value = '';
      if (!file || busy || blocked) return;
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
        void router.push('/');
      } catch {
        setError('network_error');
        setBusy(null);
      }
    },
    [busy, blocked, mutate, router],
  );

  const skip = useCallback(() => {
    if (busy) return;
    void router.push('/');
  }, [busy, router]);

  return (
    <motion.div
      key="connect"
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
        Drop in a source &mdash; we&rsquo;ll read it, index it, and cite it for every
        answer it produces. You can add more later.
      </p>

      <div className="mt-8 grid max-w-[520px] grid-cols-1 gap-3.5 sm:grid-cols-2">
        <SourceCard
          name="Connect Notion"
          sub="Live sync via OAuth. We'll keep your workspace fresh as pages change."
          tag={blocked ? 'WAITING ON RUNTIME' : 'RECOMMENDED'}
          tagAccent
          disabled={busy !== null || blocked}
          onClick={() => void connectNotion()}
          icon={<ProviderLogo slug="notion" name="Notion" />}
          loading={busy === 'notion'}
        />
        <SourceCard
          name="Upload Notion zip"
          sub="Drop in a workspace export. Faster, no OAuth — but no live sync."
          tag={blocked ? 'WAITING ON RUNTIME' : 'FILE \u00b7 ZIP'}
          disabled={busy !== null || blocked}
          onClick={onFilePick}
          icon={<ProviderLogo slug="notion" name="Notion" />}
          loading={busy === 'zip'}
        />
      </div>

      <ComingSoonSources />

      <div className="mt-7">
        <button
          type="button"
          onClick={skip}
          disabled={busy !== null}
          className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-text-body transition-colors duration-140 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="border-b border-dotted border-text-faint pb-px transition-colors duration-140 group-hover:border-text-primary">
            Skip for now &mdash; go straight to the brain
          </span>
          <ArrowRight
            size={14}
            strokeWidth={1.5}
            className="transition-transform duration-140 group-hover:translate-x-0.5"
          />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        hidden
        onChange={onFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {blockedReason ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-[13px] font-medium text-text-subtle"
        >
          {blockedReason}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-[13px] font-medium text-destructive">
          {humanizeError(error)}
        </p>
      ) : null}
    </motion.div>
  );
}

function ComingSoonSources() {
  return (
    <section className="mt-7" aria-label="Sources coming soon">
      <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-text-faint">
        COMING SOON
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2 md:grid-cols-4">
        {COMING_SOON_SOURCES.map((s) => {
          const logo = providerLogo(s.slug);
          return (
            <div
              key={s.name}
              aria-disabled="true"
              title={`${s.name} — ${s.eta}`}
              className="rounded-xl border border-border bg-white px-3 py-2.5 opacity-60"
            >
              <div className="flex items-center gap-1.5">
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    aria-hidden="true"
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded"
                    loading="lazy"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted font-mono text-[10px] text-text-faint"
                  >
                    {s.monogram}
                  </span>
                )}
                <span className="truncate text-[12px] text-text-faint">{s.name}</span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-text-faint">{s.eta}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProviderLogo({ slug, name }: { slug: string; name: string }) {
  const src = providerLogo(slug);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={`${name} logo`}
      width={16}
      height={16}
      className="h-4 w-4"
      loading="lazy"
    />
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
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-white">
          {icon}
        </span>
        <p className="mt-3.5 text-sm font-medium text-text-primary">{name}</p>
        <p className="mt-1 text-xs leading-[1.5] text-text-subtle">{sub}</p>
      </div>
      <p className={`mt-2.5 font-mono text-[10px] tracking-[0.04em] ${tagAccent ? 'text-accent' : 'text-accent'}`}>
        {loading ? 'WORKING\u2026' : tag}
      </p>
    </button>
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
    case 'connection_failed':
      return 'Couldn\u2019t start the connection. Try again.';
    case 'upload_failed':
      return 'That zip didn\u2019t upload. Check the file and try again.';
    case 'workspace_not_ready':
      return 'Brain runtime isn\u2019t ready yet. Give it a moment and try again.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'network_error':
      return 'Couldn\u2019t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
