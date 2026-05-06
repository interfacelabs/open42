import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type SignInState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'verifying' }
  | { status: 'sent'; expiresAt: string }
  | { status: 'error'; message: string };

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SignInState>({ status: 'idle' });

  useEffect(() => {
    if (!router.isReady) return;
    const payload = verificationPayload(router.query, window.location.hash);
    if (!payload) return;

    setState({ status: 'verifying' });
    void fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      if (!response.ok) {
        setState({ status: 'error', message: 'magic_link_invalid' });
        return;
      }
      const payload = await response.json();
      await router.replace(payload.redirectTo ?? '/auth/home');
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'submitting' });
    const response = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setState({ status: 'error', message: payload.error ?? 'signin_failed' });
      return;
    }
    setState({
      status: 'sent',
      expiresAt: payload.expiresAt,
    });
  }

  return (
    <>
      <Head>
        <title>Sign in - Open42</title>
      </Head>
      <main className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-landing">
          <Link href="/sign_in" className="font-mono text-sm text-text-subtle">
            open42
          </Link>

          <section className="pt-24">
            <p className="font-mono text-xs text-text-subtle">BOUNDARY 1</p>
            <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
              Sign in with a magic link.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-body text-text-body">
              Open42 keeps user auth separate from the tenant brain. Your session opens
              the shell; gbrain credentials stay encrypted behind the second boundary.
            </p>

            {state.status === 'verifying' ? (
              <div className="mt-10 max-w-xl rounded-2xl border border-border bg-white p-5 text-sm leading-body text-text-body">
                <p className="font-medium text-text-primary">Checking your link.</p>
                <p className="mt-2">
                  If the link is valid, your session will open the brain home.
                </p>
              </div>
            ) : null}

            {state.status !== 'verifying' ? (
              <form onSubmit={submit} className="mt-10 max-w-md space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-text-primary">Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    required
                    autoComplete="email"
                    className="mt-2 h-11 w-full rounded-input border border-border bg-card px-4 text-sm text-text-primary outline-none transition-colors focus:border-input focus:ring-2 focus:ring-ring/20"
                  />
                </label>
                <Button type="submit" disabled={state.status === 'submitting'}>
                  {state.status === 'submitting' ? 'Sending' : 'Send magic link'}
                </Button>
              </form>
            ) : null}

            {state.status === 'sent' ? (
              <div className="mt-8 max-w-xl rounded-2xl border border-border bg-white p-5 text-sm leading-body text-text-body">
                <p className="font-medium text-text-primary">Check your email.</p>
                <p className="mt-2">
                  Supabase sent a magic link. Open it in this browser to finish
                  signing in and provision your brain.
                </p>
                <p className="mt-3 font-mono text-xs text-text-subtle">
                  Expires {new Date(state.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            ) : null}

            {state.status === 'error' ? (
              <p className="mt-6 text-sm text-destructive">{state.message}</p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
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
