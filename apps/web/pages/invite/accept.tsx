import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { CardCabinet } from '@/components/onboarding/illustrations/CardCabinet';
import { csrfHeaders } from '@/lib/csrf';
import { EASE_STANDARD } from '@/lib/motion';

import { runAcceptFlow } from '@/lib/invite/accept-flow';

const PENDING_KEY = 'open42:pending_invite';
type Pending = { inviteId: string; tokenHash: string; type: string };

type AcceptState =
  | { kind: 'verifying' }
  | { kind: 'redirecting' }
  | { kind: 'expired' }
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
  mismatch: {
    heading: (
      <>
        This invite is for{' '}
        <em className="font-newsreader font-normal italic text-text-primary">
          a different email.
        </em>
      </>
    ),
    sub: (
      <>
        Sign out of your current Open42 account, then open the invite link again
        to accept it.
      </>
    ),
    quote: (
      <>
        The wrong key <em>won&rsquo;t open the right door.</em>
      </>
    ),
    attribution: '— A NOTE TO THE READER',
    showCta: false,
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
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;

    // 1. Reconstruct pending state if we just signed out (read-then-delete).
    let stashed: Pending | null = null;
    if (typeof window !== 'undefined') {
      const raw = window.sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        try {
          stashed = JSON.parse(raw) as Pending;
        } catch {
          stashed = null;
        }
        window.sessionStorage.removeItem(PENDING_KEY);
      }
    }

    // 2. Resolve credentials: stash wins, then query, then hash.
    const inviteIdFromQuery = String(router.query.invite_id ?? '');
    const tokenHashFromQuery = String(router.query.token_hash ?? '');
    const hashParams = new URLSearchParams(
      typeof window !== 'undefined'
        ? window.location.hash.replace(/^#/, '')
        : '',
    );
    const inviteId = stashed?.inviteId || inviteIdFromQuery;
    const tokenHash =
      stashed?.tokenHash ||
      tokenHashFromQuery ||
      hashParams.get('token_hash') ||
      '';
    const type =
      stashed?.type ||
      String(router.query.type ?? '') ||
      hashParams.get('type') ||
      'invite';
    const accessToken = hashParams.get('access_token') ?? null;

    // 3. Strip token material from the visible URL so refresh, history, and
    //    referrers do not retain it.
    if (typeof window !== 'undefined') {
      if (window.location.hash || tokenHashFromQuery) {
        const clean = new URL(window.location.href);
        for (const key of [
          'token_hash',
          'tokenHash',
          'access_token',
          'refresh_token',
          'type',
        ]) {
          clean.searchParams.delete(key);
        }
        clean.hash = '';
        window.history.replaceState(
          null,
          '',
          clean.pathname + (clean.search ? clean.search : ''),
        );
      }
    }

    if (!inviteId) {
      queueMicrotask(() => setState({ kind: 'error', message: 'missing_invite_id' }));
      return;
    }

    // 4. Write the stash NOW (before branching). If the user hits B2 and
    //    clicks "Sign out", sessionStorage already carries the magic-link
    //    credentials so the reloaded tab can fall back into Path A.
    // Stash the magic-link credentials so a B2 sign-out + reload picks them
    // up on the next mount and runs Path A. tokenHash is the SHA-hashed
    // Supabase verifier (single-use, short-lived) — NOT a raw bearer
    // token — so sessionStorage is acceptable. access_token (when present
    // in the URL hash fragment) is intentionally NOT stashed: a present
    // access_token means Supabase has already authenticated the user, and
    // stashing it would widen the XSS attack surface unnecessarily.
    if (tokenHash && typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ inviteId, tokenHash, type }),
      );
    }

    let cancelled = false;
    runAcceptFlow(
      { inviteId, tokenHash, type, accessToken },
      {
        clearPendingStash: () => {
          if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(PENDING_KEY);
          }
        },
      },
    )
      .then(async (outcome) => {
        if (cancelled) return;
        switch (outcome.kind) {
          case 'redirect':
            setState({ kind: 'redirecting' });
            await router.replace(outcome.to);
            return;
          case 'mismatch':
            setState({ kind: 'mismatch' });
            return;
          case 'expired':
            setState({ kind: 'expired' });
            return;
          case 'error':
            setState({ kind: 'error', message: outcome.message });
            return;
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: 'error', message: 'network' });
      });

    return () => {
      cancelled = true;
    };
    // Run once when router becomes ready. We intentionally only depend on
    // router.isReady; do NOT add router.query, router.query.invite_id, or
    // router to this array. Next's router instance changes on every
    // navigation, causing this effect to refire and loop infinitely. The
    // closure captures router.query at the moment isReady flips true,
    // which is the only run that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const copy = useMemo(() => COPY[state.kind], [state.kind]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Codex round-2 P2: backend enforces CSRF on /auth/signout — without
      // the header the request 403s as csrf_token_invalid, the catch
      // swallows it, and the user is stuck on the invite-mismatch screen.
      await fetch('/api/auth/signout', { method: 'POST', headers: csrfHeaders() });
    } catch {
      // ignore — we still want to reload so a fresh mount can re-evaluate.
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

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

                  {state.kind === 'mismatch' ? (
                    <div className="mt-7">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-b from-neutral-800 to-neutral-950 px-6 text-[15px] font-medium tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18),0_8px_20px_rgba(0,0,0,0.12)] transition-all duration-200 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {signingOut ? 'Signing out\u2026' : 'Sign out'}
                      </button>
                    </div>
                  ) : copy.showCta ? (
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
