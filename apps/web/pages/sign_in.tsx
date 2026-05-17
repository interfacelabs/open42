import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'motion/react';
import { mutate } from 'swr';

import { EditorialPane } from '@/components/onboarding/EditorialPane';
import { CardCabinet } from '@/components/onboarding/illustrations/CardCabinet';
import { Envelope } from '@/components/onboarding/illustrations/Envelope';
import { EASE_STANDARD } from '@/lib/motion';

type SignInState =
  | { status: 'idle'; error?: string }
  | { status: 'submitting' }
  | { status: 'sent'; expiresAt: string; error?: string }
  | { status: 'verifying' }
  | { status: 'error'; previous: 'idle' | 'sent'; message: string; expiresAt?: string };

const RESEND_COOLDOWN_SECONDS = 30;
const AUTH_CACHE_KEYS = ['/api/auth/me', '/api/workspaces', '/api/workspaces/current'] as const;

async function clearAuthCache(): Promise<void> {
  await Promise.all(AUTH_CACHE_KEYS.map((key) => mutate(key, undefined, { revalidate: false })));
}

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SignInState>({ status: 'idle' });
  const [code, setCode] = useState<string[]>(() => Array(6).fill(''));
  const [resendIn, setResendIn] = useState(0);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!router.isReady) return;
    const payload = verificationPayload(router.query, window.location.hash);
    if (!payload) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ status: 'verifying' });
    });
    void fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      if (cancelled) return;
      if (!response.ok) {
        setState({
          status: 'error',
          previous: 'idle',
          message: 'magic_link_invalid',
        });
        return;
      }
      const body = await response.json();
      await clearAuthCache();
      await router.replace(body.redirectTo ?? '/onboard');
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => {
      setResendIn((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  // The OTP form should stay visible across the whole "code-entry phase":
  //   - sent           → user is typing
  //   - verifying      → request in flight ("Checking your code…")
  //   - error/sent     → verify failed, show error inline
  // Otherwise we render the email form. The previous version flipped back to
  // the email form during verify, which flashed the wrong UI for ~2s and
  // stranded the user on the email form when verify failed.
  const codeStatus: 'idle' | 'sent' =
    state.status === 'sent' ||
    state.status === 'verifying' ||
    (state.status === 'error' && state.previous === 'sent')
      ? 'sent'
      : 'idle';

  const submitEmail = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      if (event) event.preventDefault();
      if (!email) return;
      setState({ status: 'submitting' });
      try {
        const response = await fetch('/api/auth/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setState({
            status: 'error',
            previous: 'idle',
            message: payload.error ?? 'signin_failed',
          });
          return;
        }
        setCode(Array(6).fill(''));
        setResendIn(RESEND_COOLDOWN_SECONDS);
        setState({
          status: 'sent',
          expiresAt: payload.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
        });
      } catch (error) {
        setState({
          status: 'error',
          previous: 'idle',
          message: 'network_error',
        });
      }
    },
    [email],
  );

  const submitCode = useCallback(
    async (digits: string[]) => {
      const token = digits.join('');
      if (token.length !== 6 || verifiedRef.current) return;
      verifiedRef.current = true;
      const previousExpires =
        state.status === 'sent'
          ? state.expiresAt
          : state.status === 'error'
            ? state.expiresAt
            : undefined;
      setState({ status: 'verifying' });
      try {
        const response = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, token, type: 'email' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          verifiedRef.current = false;
          setState({
            status: 'error',
            previous: 'sent',
            message: payload.error ?? 'verify_failed',
            expiresAt: previousExpires,
          });
          return;
        }
        await clearAuthCache();
        await router.replace(payload.redirectTo ?? '/onboard');
      } catch (error) {
        verifiedRef.current = false;
        setState({
          status: 'error',
          previous: 'sent',
          message: 'network_error',
          expiresAt: previousExpires,
        });
      }
    },
    [email, router, state],
  );

  const handleDigitChange = useCallback(
    (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value.replace(/\D/g, '');
      if (!raw) {
        setCode((prev) => {
          if (prev[index] === '') return prev;
          const next = prev.slice();
          next[index] = '';
          return next;
        });
        if (state.status === 'error') {
          setState({
            status: 'sent',
            expiresAt: state.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
          });
        }
        return;
      }
      const digit = raw.slice(-1);
      let snapshot: string[] = [];
      setCode((prev) => {
        const next = prev.slice();
        next[index] = digit;
        snapshot = next;
        return next;
      });
      if (state.status === 'error') {
        setState({
          status: 'sent',
          expiresAt: state.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
        });
      }
      if (index < 5) {
        codeRefs.current[index + 1]?.focus();
      } else if (snapshot.every((d) => d.length === 1)) {
        void submitCode(snapshot);
      }
    },
    [state, submitCode],
  );

  const handleDigitKeyDown = useCallback(
    (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Backspace') {
        if (code[index]) return;
        if (index > 0) {
          event.preventDefault();
          codeRefs.current[index - 1]?.focus();
          setCode((prev) => {
            const next = prev.slice();
            next[index - 1] = '';
            return next;
          });
        }
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        codeRefs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowRight' && index < 5) {
        event.preventDefault();
        codeRefs.current[index + 1]?.focus();
      }
    },
    [code],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (!text) return;
      event.preventDefault();
      const digits = Array.from({ length: 6 }, (_, i) => text[i] ?? '');
      setCode(digits);
      const lastFilled = Math.min(text.length - 1, 5);
      codeRefs.current[lastFilled]?.focus();
      if (text.length === 6) {
        void submitCode(digits);
      }
    },
    [submitCode],
  );

  const resendCode = useCallback(async () => {
    if (resendIn > 0 || !email) return;
    await submitEmail();
  }, [resendIn, email, submitEmail]);

  const editEmail = useCallback(() => {
    verifiedRef.current = false;
    setCode(Array(6).fill(''));
    setState({ status: 'idle' });
  }, []);

  const editorial = useMemo(() => {
    if (codeStatus === 'sent') {
      return {
        quote: (
          <>
            Six digits between you
            <br />
            and <em>everything you&apos;ve ever written.</em>
          </>
        ),
        attribution: '— OPEN42 SIGN-IN, PROBABLY',
        illustration: <Envelope />,
      };
    }
    return {
      quote: (
        <>
          What your team <em>wrote down.</em>
          <br />
          And what your team <em>actually meant.</em>
        </>
      ),
      attribution: '— A NOTE TO THE READER',
      illustration: <CardCabinet />,
    };
  }, [codeStatus]);

  const verifying = state.status === 'verifying';
  const submitting = state.status === 'submitting';
  const errorMessage = state.status === 'error' ? state.message : undefined;
  const errorScope = state.status === 'error' ? state.previous : null;

  return (
    <>
      <Head>
        <title>Sign in - Open42</title>
      </Head>
      <main className="min-h-screen bg-background">
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-1 flex-col px-6 py-8 md:px-16 md:py-12">
            <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-text-primary">
              <span className="h-[10px] w-[10px] rounded-full bg-accent" aria-hidden="true" />
              open42
            </span>

            <div className="mt-16 flex flex-1 items-start md:mt-24 md:items-center">
              <div className="w-full max-w-[380px]">
                {codeStatus === 'idle' ? (
                  <motion.div
                    key="idle"
                    initial={false}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.32, ease: EASE_STANDARD },
                    }}
                  >
                    <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
                      A brain{' '}
                      <em className="font-newsreader font-normal italic text-text-primary">
                        that remembers.
                      </em>
                    </h1>
                    <p className="mt-3.5 max-w-[36ch] text-sm leading-body text-text-body">
                      Sign in to the company memory you&apos;ve been building. We&apos;ll send a
                      6-digit code.
                    </p>
                    <form onSubmit={submitEmail} className="mt-7" noValidate>
                      <label
                        htmlFor="signin-email"
                        className="mb-2 block text-[13px] font-medium text-text-primary"
                      >
                        Work email
                      </label>
                      <input
                        id="signin-email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        aria-invalid={errorScope === 'idle' || undefined}
                        className="h-11 w-full rounded-input border border-input bg-white px-3.5 text-sm text-text-primary outline-none transition-[border-color,box-shadow] duration-140 focus:border-accent focus:shadow-[0_0_0_4px_rgba(29,77,255,0.10)]"
                      />
                      <button
                        type="submit"
                        disabled={submitting || !email}
                        className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-b from-neutral-800 to-neutral-950 px-6 text-[15px] font-medium tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18),0_8px_20px_rgba(0,0,0,0.12)] transition-all duration-200 hover:brightness-110 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? 'Sending…' : 'Continue →'}
                      </button>
                      {errorScope === 'idle' && errorMessage ? (
                        <p role="alert" className="mt-3 text-[13px] font-medium text-destructive">
                          {humanizeError(errorMessage)}
                        </p>
                      ) : null}
                      <p className="mt-6 text-xs leading-[1.7] text-text-subtle">
                        Prefer a magic link?{' '}
                        <a
                          href="#"
                          className="font-medium text-accent border-b border-accent/25 hover:border-accent"
                        >
                          We&apos;ll mail you one.
                        </a>
                        <br />
                        By continuing you agree to the{' '}
                        <a
                          href="#"
                          className="font-medium text-accent border-b border-accent/25 hover:border-accent"
                        >
                          Terms
                        </a>{' '}
                        and{' '}
                        <a
                          href="#"
                          className="font-medium text-accent border-b border-accent/25 hover:border-accent"
                        >
                          Privacy
                        </a>
                        .
                      </p>
                    </form>
                  </motion.div>
                ) : (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.32, ease: EASE_STANDARD },
                    }}
                  >
                    <h1 className="text-[38px] font-medium leading-[1.06] tracking-[-0.025em] text-text-primary">
                      Enter{' '}
                      <em className="font-newsreader font-normal italic text-text-primary">
                        the code.
                      </em>
                    </h1>
                    <p className="mt-3.5 max-w-[36ch] text-sm leading-body text-text-body">
                      We sent a 6-digit code to{' '}
                      <span className="font-medium text-text-primary">{email}</span>. Type it here.
                    </p>
                    <div
                      className="mt-7 flex gap-2.5"
                      role="group"
                      aria-label="6-digit verification code"
                    >
                      {code.map((digit, index) => (
                        <input
                          key={index}
                          ref={(el) => {
                            codeRefs.current[index] = el;
                          }}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]"
                          maxLength={1}
                          autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          aria-label={`digit ${index + 1} of 6`}
                          value={digit}
                          disabled={verifying}
                          onChange={handleDigitChange(index)}
                          onKeyDown={handleDigitKeyDown(index)}
                          onPaste={index === 0 ? handlePaste : undefined}
                          onFocus={(event) => event.target.select()}
                          className="h-16 w-14 rounded-xl border border-input bg-white text-center font-mono text-[26px] font-medium text-text-primary outline-none transition-[border-color,box-shadow] duration-140 focus:border-accent focus:shadow-[0_0_0_4px_rgba(29,77,255,0.12)] disabled:opacity-60"
                        />
                      ))}
                    </div>
                    {verifying ? (
                      <p aria-live="polite" className="mt-4 font-mono text-xs text-text-subtle">
                        Checking your code…
                      </p>
                    ) : null}
                    {errorScope === 'sent' && errorMessage ? (
                      <p role="alert" className="mt-4 text-[13px] font-medium text-destructive">
                        {humanizeError(errorMessage)}
                      </p>
                    ) : null}
                    <p className="mt-7 text-xs leading-[1.7] text-text-subtle">
                      Didn&apos;t get it?{' '}
                      <button
                        type="button"
                        onClick={resendCode}
                        disabled={resendIn > 0 || submitting}
                        className="bg-transparent border-0 p-0 text-text-subtle underline underline-offset-[3px] hover:text-text-primary disabled:cursor-not-allowed disabled:no-underline disabled:hover:text-text-subtle"
                      >
                        {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                      </button>
                      &nbsp;·&nbsp;
                      <button
                        type="button"
                        onClick={editEmail}
                        className="bg-transparent border-0 p-0 text-text-subtle underline underline-offset-[3px] hover:text-text-primary"
                      >
                        Wrong email
                      </button>
                      <br />
                      Or{' '}
                      <a
                        href="#"
                        className="font-medium text-accent border-b border-accent/25 hover:border-accent"
                      >
                        click the link in your email
                      </a>{' '}
                      instead.
                    </p>
                  </motion.div>
                )}
              </div>
            </div>
          </div>

          <EditorialPane
            quote={editorial.quote}
            attribution={editorial.attribution}
            illustration={editorial.illustration}
          />
        </div>
      </main>
    </>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case 'signin_rate_limited':
      return 'Too many attempts. Try again in a moment.';
    case 'signin_not_allowed':
      return 'This email is not authorized for the private beta yet. Use your invite link if you were invited.';
    case 'verify_failed':
    case 'invalid_code':
      return 'That code didn\u2019t match. Try again or resend.';
    case 'magic_link_invalid':
      return 'That link is no longer valid. Enter your email to get a fresh code.';
    case 'network_error':
      return 'Couldn\u2019t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

function verificationPayload(
  query: Record<string, string | string[] | undefined>,
  hash: string,
): Record<string, string> | null {
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  if (accessToken) return { accessToken };

  const tokenHash = single(query.token_hash) ?? single(query.tokenHash);
  const type = single(query.type);
  if (tokenHash && type) return { tokenHash, type };

  const email = single(query.email);
  const token = single(query.token);
  if (email && token) return { email, token, type: type ?? 'email' };

  return null;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
