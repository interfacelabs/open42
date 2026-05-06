import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type SignOutState = 'signing-out' | 'done' | 'error';

export default function SignOutPage() {
  const [state, setState] = useState<SignOutState>('signing-out');

  useEffect(() => {
    const csrf = document.cookie
      .split('; ')
      .find((part) => part.startsWith('open42_csrf='))
      ?.split('=')[1];

    void fetch('/api/auth/signout', {
      method: 'POST',
      headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
    }).then((response) => {
      setState(response.ok ? 'done' : 'error');
    });
  }, []);

  return (
    <>
      <Head>
        <title>Sign out - Open42</title>
      </Head>
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <section className="max-w-md text-center">
          <p className="font-mono text-xs text-text-subtle">SESSION</p>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-text-primary">
            {state === 'signing-out'
              ? 'Signing you out.'
              : state === 'done'
                ? 'You are signed out.'
                : 'Sign out did not finish.'}
          </h1>
          <p className="mt-4 text-sm leading-body text-text-body">
            {state === 'error'
              ? 'The browser session could not be cleared. Try again from the same tab.'
              : 'Your product session is separate from the tenant brain runtime.'}
          </p>
          <div className="mt-8">
            <Button asChild variant="secondary">
              <Link href="/sign_in">Return to sign in</Link>
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
