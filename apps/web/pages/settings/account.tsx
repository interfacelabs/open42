import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { fetcher } from '@/lib/api';

interface MeResponse {
  id: string;
  email: string;
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const { data, error } = useSWR<MeResponse>('/api/auth/me', fetcher);

  useEffect(() => {
    if ((error as { status?: number } | undefined)?.status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  const email = data?.email ?? '';

  return (
    <>
      <Head>
        <title>Account — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="ACCOUNT"
          title="Account settings"
          subtitle="Manage the identity you use to sign in to Open42. Workspace-specific controls live under workspace settings."
        />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-2xl space-y-8">
            <section>
              <SectionHeading>Email</SectionHeading>
              <div className="mt-3 rounded-xl border border-border bg-white p-5">
                <label
                  htmlFor="account-email"
                  className="block text-[13px] font-medium text-text-primary"
                >
                  Current email
                </label>
                <input
                  id="account-email"
                  type="email"
                  value={email}
                  readOnly
                  className="mt-2 h-10 w-full rounded-input border border-input bg-panel-soft px-3 text-[14px] text-text-body outline-none"
                />
                <p className="mt-3 text-[13px] leading-body text-text-subtle">
                  Email changes need an account transfer flow so workspace ownership and audit
                  history stay intact.
                </p>
                <div className="mt-4">
                  <Button type="button" variant="secondary" disabled>
                    Change email
                  </Button>
                </div>
              </div>
            </section>

            <section>
              <SectionHeading>Password</SectionHeading>
              <div className="mt-3 rounded-xl border border-border bg-white p-5">
                <p className="text-[14px] font-medium text-text-primary">
                  Open42 uses magic-link sign-in.
                </p>
                <p className="mt-2 text-[13px] leading-body text-text-subtle">
                  There is no account password to rotate in this deployment. Sign-in links are
                  issued by email and expire after a short window.
                </p>
                <div className="mt-4">
                  <Button type="button" variant="secondary" disabled>
                    Change password
                  </Button>
                </div>
              </div>
            </section>

            <section>
              <SectionHeading>Session</SectionHeading>
              <div className="mt-3 rounded-xl border border-border bg-white p-5">
                <p className="text-[13px] leading-body text-text-subtle">
                  Signing out clears the Open42 web session. It does not stop the tenant brain
                  runtime.
                </p>
                <div className="mt-4">
                  <Button asChild variant="secondary">
                    <Link href="/sign_out">Sign out</Link>
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </AppShell>
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-faint">
      {children}
    </h2>
  );
}
