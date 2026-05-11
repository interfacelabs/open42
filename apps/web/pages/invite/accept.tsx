import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { CardCabinet } from '@/components/onboarding/illustrations/CardCabinet';
import { EASE_STANDARD } from '@/lib/motion';

type AcceptState =
  | { kind: 'verifying' }
  | { kind: 'redirecting' }
  | { kind: 'expired' }
  | { kind: 'blocked' }
  | { kind: 'mismatch' }
  | { kind: 'error'; message: string };

interface StateCopy {
  heading: ReactNode;
  sub: ReactNode;
  quote: ReactNode;
  attribution: string;
  showCta: boolean;
}

const COPY: Record<AcceptState['kind'], StateCopy> = {
  verifying: {
    heading: (
      <>
        Checking{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          your invite.
        </em>
      </>
    ),
    sub: <>One moment &mdash; we&rsquo;re verifying your invite link.</>,
    quote: <>Almost there.</>,
    attribution: '— A NOTE TO THE READER',
    showCta: false,
  },
  redirecting: {
    heading: <>You&rsquo;re in.</>,
    sub: <>Taking you to the brain&hellip;</>,
    quote: <>Welcome.</>,
    attribution: '— A NOTE TO THE READER',
    showCta: false,
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
        Invite links are valid for 24 hours. Ask the inviter to send a fresh one.
      </>
    ),
    quote: (
      <>
        Time, alas, <em>is unforgiving.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    showCta: true,
  },
  blocked: {
    heading: (
      <>
        You already have{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          a brain.
        </em>
      </>
    ),
    sub: (
      <>
        Open42 supports one workspace per account in P1. Ask your team admin to
        merge later, or sign in to your existing brain.
      </>
    ),
    quote: (
      <>
        One brain <em>at a time.</em>
      </>
    ),
    attribution: '— OPEN42 OPERATING PRINCIPLE №5',
    showCta: true,
  },
  mismatch: {
    heading: (
      <>
        Wrong{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          email.
        </em>
      </>
    ),
    sub: (
      <>
        This invite was sent to a different address. Sign in with the email the
        invite was sent to.
      </>
    ),
    quote: (
      <>
        The wrong key <em>won&rsquo;t open the right door.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    showCta: true,
  },
  error: {
    heading: (
      <>
        Something{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          went wrong.
        </em>
      </>
    ),
    sub: (
      <>
        We couldn&rsquo;t verify your invite. Try the link again, or ask the
        inviter to resend.
      </>
    ),
    quote: (
      <>
        Sometimes the system breaks.
        <br />
        <em>Sorry about that.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    showCta: true,
  },
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const [state, setState] = useState<AcceptState>({ kind: 'verifying' });

  useEffect(() => {
    if (!router.isReady) return;

    const inviteId = String(router.query.invite_id ?? '');
    const tokenHashFromQuery = String(router.query.token_hash ?? '');
    const hashParams = new URLSearchParams(
      typeof window !== 'undefined'
        ? window.location.hash.replace(/^#/, '')
        : '',
    );
    const tokenHashFromHash = hashParams.get('token_hash') ?? '';
    const accessTokenFromHash = hashParams.get('access_token') ?? '';
    const tokenHash = tokenHashFromQuery || tokenHashFromHash;
    const type = String(
      router.query.type ?? hashParams.get('type') ?? 'invite',
    );

    if (!inviteId || (!tokenHash && !accessTokenFromHash)) {
      setState({ kind: 'error', message: 'invalid_link' });
      return;
    }

    // Strip token material from URL so refresh, history, and referrers do not retain it.
    if (typeof window !== 'undefined') {
      const clean = new URL(window.location.href);
      for (const key of ['token_hash', 'tokenHash', 'access_token', 'refresh_token', 'type']) {
        clean.searchParams.delete(key);
      }
      clean.hash = '';
      window.history.replaceState(
        null,
        '',
        clean.pathname + (clean.search ? clean.search : ''),
      );
    }

    let cancelled = false;
    void fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        accessTokenFromHash
          ? { accessToken: accessTokenFromHash, inviteId }
          : { tokenHash, type, inviteId },
      ),
    })
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setState({ kind: 'redirecting' });
          await router.replace(body.redirectTo ?? '/');
          return;
        }
        if (body?.error === 'invite_expired') setState({ kind: 'expired' });
        else if (body?.error === 'invite_blocked')
          setState({ kind: 'blocked' });
        else if (body?.error === 'invite_email_mismatch')
          setState({ kind: 'mismatch' });
        else
          setState({
            kind: 'error',
            message: body?.error ?? 'unknown',
          });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: 'error', message: 'network' });
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const copy = useMemo(() => COPY[state.kind], [state.kind]);

  return (
    <>
      <Head>
        <title>Invite - Open42</title>
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
              <div className="w-full max-w-[420px]">
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
                  <p className="mt-3.5 max-w-[40ch] text-sm leading-body text-text-body">
                    {copy.sub}
                  </p>

                  {state.kind === 'verifying' || state.kind === 'redirecting' ? (
                    <p
                      aria-live="polite"
                      className="mt-7 flex items-center gap-2 font-mono text-xs text-text-subtle"
                    >
                      <span
                        className="h-[7px] w-[7px] rounded-full bg-accent"
                        style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
                        aria-hidden="true"
                      />
                      {state.kind === 'verifying'
                        ? 'verifying\u2026'
                        : 'redirecting\u2026'}
                    </p>
                  ) : null}

                  {copy.showCta ? (
                    <div className="mt-7">
                      <Link
                        href="/sign_in"
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-b from-neutral-800 to-neutral-950 px-6 text-[15px] font-medium tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18),0_8px_20px_rgba(0,0,0,0.12)] transition-all duration-200 hover:brightness-110 active:translate-y-px"
                      >
                        Open sign in &rarr;
                      </Link>
                    </div>
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
