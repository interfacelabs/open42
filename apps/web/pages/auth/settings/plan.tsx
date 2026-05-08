import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useSWR from 'swr';

import { Sidebar } from '@/components/Sidebar';

interface PlanCurrentPayload {
  user: { id: string; email: string };
  workspace: {
    id: string;
    name: string;
    runtime: 'pending' | 'ready' | 'failed';
    status?: string;
    plan?: string | null;
    gbrainReady?: boolean;
    createdAt?: string;
  } | null;
  invites: Array<{ id: string; email: string; status: string }>;
  connections: unknown[];
  lastJob: unknown | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

interface PlanCard {
  id: string;
  name: string;
  price: string;
  detail: string;
  status: 'current' | 'coming-soon';
}

const PLANS: PlanCard[] = [
  {
    id: 'starter',
    name: 'Free',
    price: '$0/mo',
    detail: 'One company brain, zip imports, basic ingestion.',
    status: 'current',
  },
  {
    id: 'team',
    name: 'Team',
    price: '$149/mo',
    detail: 'Shared workspace, live connectors.',
    status: 'coming-soon',
  },
  {
    id: 'business',
    name: 'Business',
    price: '$399/mo',
    detail: 'Higher limits, priority sync.',
    status: 'coming-soon',
  },
];

export default function PlanSettingsPage() {
  const router = useRouter();
  const { error } = useSWR<PlanCurrentPayload>(
    '/api/workspaces/current',
    fetcher,
  );

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  return (
    <>
      <Head>
        <title>Plan - Open42</title>
      </Head>
      <main className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 px-10 py-10">
          <div className="max-w-4xl">
            <header>
              <p className="font-mono text-xs text-text-subtle">BILLING</p>
              <h1 className="mt-4 text-4xl font-medium leading-headline tracking-tight text-text-primary md:text-5xl">
                Plan
              </h1>
              <p className="mt-3 max-w-[52ch] text-sm leading-body text-text-body">
                Where you are today, and what&rsquo;s coming next.
              </p>
            </header>

            <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              {PLANS.map((plan) => (
                <PlanCardView key={plan.id} plan={plan} />
              ))}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

function PlanCardView({ plan }: { plan: PlanCard }) {
  const isCurrent = plan.status === 'current';
  return (
    <article
      className={`flex min-h-[180px] flex-col justify-between rounded-2xl border border-border bg-white p-6 ${
        isCurrent ? '' : 'opacity-70'
      }`}
    >
      <div>
        <span
          className={
            isCurrent
              ? 'inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-accent'
              : 'inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-text-subtle'
          }
        >
          {isCurrent ? 'Current plan' : 'Coming soon'}
        </span>
        <p className="mt-4 text-base font-medium text-text-primary">
          {plan.name}
        </p>
        <p className="mt-1 text-2xl font-medium tracking-tight text-text-primary">
          {plan.price}
        </p>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-text-subtle">
        {plan.detail}
      </p>
    </article>
  );
}
