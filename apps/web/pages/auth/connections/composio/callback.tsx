import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { CardCabinet } from '@/components/onboarding/illustrations/CardCabinet';
import { EASE_STANDARD } from '@/lib/motion';

type CallbackState =
  | { kind: 'verifying' }
  | { kind: 'redirecting' }
  | { kind: 'composio_failed' }
  | { kind: 'expired' }
  | { kind: 'inactive' }
  | { kind: 'verify_failed'; code: string }
  | { kind: 'server_error'; code: string };

interface StateCopy {
  heading: ReactNode;
  sub: ReactNode;
  quote: ReactNode;
  attribution: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

const COPY: Record<CallbackState['kind'], StateCopy> = {
  verifying: {
    heading: (
      <>
        Linking{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          your Notion.
        </em>
      </>
    ),
    sub: <>One moment &mdash; we&rsquo;re finishing the handshake with Composio.</>,
    quote: <>Almost there.</>,
    attribution: '— A NOTE TO THE READER',
  },
  redirecting: {
    heading: (
      <>
        Notion{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          is in.
        </em>
      </>
    ),
    sub: <>Heading to your brain&hellip;</>,
    quote: <>Welcome.</>,
    attribution: '— A NOTE TO THE READER',
  },
  composio_failed: {
    heading: (
      <>
        Notion{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          declined.
        </em>
      </>
    ),
    sub: (
      <>
        The Notion authorization didn&rsquo;t complete. You can try the connection
        again, or skip and add a source later.
      </>
    ),
    quote: (
      <>
        Some doors <em>need a second knock.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    primaryCta: { label: 'Try again \u2192', href: '/' },
    secondaryCta: { label: 'Skip for now', href: '/' },
  },
  expired: {
    heading: (
      <>
        This link{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          has expired.
        </em>
      </>
    ),
    sub: (
      <>
        Composio connection links are valid for 10 minutes. Start the connection
        again from your brain.
      </>
    ),
    quote: (
      <>
        Time, alas, <em>is unforgiving.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    primaryCta: { label: 'Start over \u2192', href: '/' },
  },
  inactive: {
    heading: (
      <>
        Connection{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          isn&rsquo;t active yet.
        </em>
      </>
    ),
    sub: (
      <>
        Composio reported the account isn&rsquo;t active. Re-authorize Notion and
        try again.
      </>
    ),
    quote: <>Try once more.</>,
    attribution: '— A NOTE TO THE READER',
    primaryCta: { label: 'Try again \u2192', href: '/' },
    secondaryCta: { label: 'Skip for now', href: '/' },
  },
  verify_failed: {
    heading: (
      <>
        We couldn&rsquo;t{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          verify this.
        </em>
      </>
    ),
    sub: (
      <>
        The connection didn&rsquo;t check out. Please start the connection again
        from your brain.
      </>
    ),
    quote: (
      <>
        The wrong key <em>won&rsquo;t open the right door.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    primaryCta: { label: 'Start over \u2192', href: '/' },
    secondaryCta: { label: 'Skip for now', href: '/' },
  },
  server_error: {
    heading: (
      <>
        Something{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          went wrong.
        </em>
      </>
    ),
    sub: <>We hit a snag finishing the connection. Try again in a moment.</>,
    quote: (
      <>
        Sometimes the system breaks.
        <br />
        <em>Sorry about that.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    primaryCta: { label: 'Try again \u2192', href: '/' },
    secondaryCta: { label: 'Skip for now', href: '/' },
  },
};

export default function ComposioCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState>({ kind: 'verifying' });
  const startedRef = useRef(false);

  useEffect(() => {
    if (!router.isReady || startedRef.current) return;
    startedRef.current = true;

    const stateToken = String(router.query.state ?? '');
    const connectedAccountId = String(router.query.connected_account_id ?? '');
    const composioStatus = String(router.query.status ?? 'success');

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (!stateToken || !connectedAccountId) {
      setState({ kind: 'verify_failed', code: 'missing_params' });
      return;
    }
    if (composioStatus !== 'success') {
      setState({ kind: 'composio_failed' });
      return;
    }

    let cancelled = false;
    void fetch('/api/connections/composio/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ state: stateToken, connectedAccountId }),
    })
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (res.ok || body?.error === 'already_connected') {
          setState({ kind: 'redirecting' });
          const target = typeof body?.redirectTo === 'string' ? body.redirectTo : '/';
          await router.replace(target);
          return;
        }
        switch (body?.error) {
          case 'state_expired':
            setState({ kind: 'expired' });
            return;
          case 'account_not_active':
            setState({ kind: 'inactive' });
            return;
          case 'state_invalid':
          case 'state_metadata_mismatch':
          case 'state_user_mismatch':
          case 'account_id_mismatch':
          case 'missing_params':
            setState({ kind: 'verify_failed', code: body.error });
            return;
          case 'composio_not_configured':
            setState({ kind: 'server_error', code: 'composio_not_configured' });
            return;
          case 'unauthorized':
            await router.replace('/sign_in');
            return;
          default:
            setState({ kind: 'server_error', code: body?.error ?? 'unknown' });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: 'server_error', code: 'network' });
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const copy = useMemo(() => COPY[state.kind], [state.kind]);
  const showLiveStatus = state.kind === 'verifying' || state.kind === 'redirecting';

  return (
    <>
      <Head>
        <title>Connecting Notion - Open42</title>
      </Head>
      <main className="min-h-screen bg-background">
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
            <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
              <span
                className="h-[10px] w-[10px] rounded-full bg-accent"
                aria-hidden="true"
              />
              open42
            </span>

            <div className="mt-16 flex flex-1 items-start md:mt-24 md:items-center">
              <div className="w-full max-w-[440px]">
                <motion.div
                  key={state.kind}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.32, ease: EASE_STANDARD },
                  }}
                >
                  <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
                    {copy.heading}
                  </h1>
                  <p className="mt-3.5 max-w-[42ch] text-sm leading-body text-text-body">
                    {copy.sub}
                  </p>

                  {showLiveStatus ? (
                    <p
                      aria-live="polite"
                      className="mt-7 flex items-center gap-2 font-mono text-xs text-text-subtle"
                    >
                      <span
                        className="h-[7px] w-[7px] rounded-full bg-accent"
                        style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
                        aria-hidden="true"
                      />
                      {state.kind === 'verifying' ? 'verifying\u2026' : 'redirecting\u2026'}
                    </p>
                  ) : null}

                  {copy.primaryCta ? (
                    <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2.5">
                      <Link
                        href={copy.primaryCta.href}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-b from-neutral-800 to-neutral-950 px-6 text-[15px] font-medium tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18),0_8px_20px_rgba(0,0,0,0.12)] transition-all duration-200 hover:brightness-110 active:translate-y-px"
                      >
                        {copy.primaryCta.label}
                      </Link>
                      {copy.secondaryCta ? (
                        <Link
                          href={copy.secondaryCta.href}
                          className="text-xs text-text-subtle underline underline-offset-[3px] hover:text-text-primary"
                        >
                          {copy.secondaryCta.label}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {state.kind === 'verify_failed' || state.kind === 'server_error' ? (
                    <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
                      reason: {state.code}
                    </p>
                  ) : null}
                </motion.div>
              </div>
            </div>
          </div>

          <EditorialPane
            quote={copy.quote}
            attribution={copy.attribution}
            illustration={<CardCabinet />}
          />
        </div>
      </main>
    </>
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
