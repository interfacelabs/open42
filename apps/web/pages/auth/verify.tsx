import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

type VerifyState = 'checking' | 'failed';

export default function VerifyPage() {
  const router = useRouter();
  const [state, setState] = useState<VerifyState>('checking');

  useEffect(() => {
    const token = typeof router.query.token === 'string' ? router.query.token : '';
    if (!router.isReady || !token) return;

    void fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) {
        setState('failed');
        return;
      }
      const payload = await response.json();
      await router.replace(payload.redirectTo ?? '/home');
    });
  }, [router]);

  return (
    <>
      <Head>
        <title>Verifying - Open42</title>
      </Head>
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <p className="font-mono text-xs text-text-subtle">AUTH VERIFY</p>
          <h1 className="mt-4 text-3xl font-medium tracking-tight text-text-primary">
            {state === 'checking' ? 'Checking your link.' : 'This link is not valid.'}
          </h1>
          <p className="mt-4 text-sm leading-body text-text-body">
            {state === 'checking'
              ? 'If the link is valid, your session will open the brain home.'
              : 'Magic links expire after 15 minutes and can only be used once.'}
          </p>
        </div>
      </main>
    </>
  );
}
