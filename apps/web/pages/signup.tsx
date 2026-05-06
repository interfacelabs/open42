import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';

type SignupState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'sent'; magicLinkUrl: string; expiresAt: string }
  | { status: 'error'; message: string };

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SignupState>({ status: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'submitting' });
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setState({ status: 'error', message: payload.error ?? 'signup_failed' });
      return;
    }
    setState({
      status: 'sent',
      magicLinkUrl: payload.magicLinkUrl,
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
          <Link href="/" className="font-mono text-sm text-text-subtle">
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

            {state.status === 'sent' ? (
              <div className="mt-8 max-w-xl rounded-2xl border border-border bg-white p-5 text-sm leading-body text-text-body">
                <p className="font-medium text-text-primary">Magic link issued.</p>
                <p className="mt-2">
                  Email delivery is not wired in this local build, so the verification
                  link is exposed here for development.
                </p>
                <Link
                  href={state.magicLinkUrl}
                  className="mt-4 inline-block break-all font-mono text-xs text-accent hover:text-accent/80"
                >
                  {state.magicLinkUrl}
                </Link>
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
