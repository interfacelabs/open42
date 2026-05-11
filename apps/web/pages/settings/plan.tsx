import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { cn } from '@/lib/utils';

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
    price: '$0',
    detail: 'One company brain, zip imports, basic ingestion.',
    status: 'current',
  },
  {
    id: 'team',
    name: 'Team',
    price: '$149',
    detail: 'Shared workspace, live connectors.',
    status: 'coming-soon',
  },
  {
    id: 'business',
    name: 'Business',
    price: '$399',
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
        <title>Plan — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · BILLING"
          title="Plan"
          subtitle={
            <>
              Where you are today, and what&rsquo;s{' '}
              <span className="font-serif italic">coming next.</span>
            </>
          }
        />
        <SettingsNav active="plan" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <section className="grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCardView key={plan.id} plan={plan} />
            ))}
          </section>
        </div>
      </AppShell>
    </>
  );
}

function PlanCardView({ plan }: { plan: PlanCard }) {
  const isCurrent = plan.status === 'current';
  return (
    <article
      className={cn(
        'flex min-h-[200px] flex-col justify-between rounded-xl border bg-white p-6 transition-colors duration-140',
        isCurrent
          ? 'border-blue-line shadow-card'
          : 'border-border-soft opacity-90',
      )}
    >
      <div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]',
            isCurrent
              ? 'bg-blue-soft text-blue'
              : 'bg-panel-soft text-text-subtle',
          )}
        >
          {isCurrent ? 'Current plan' : 'Coming soon'}
        </span>
        <p className="mt-4 text-[15px] font-medium text-text-primary">
          {plan.name}
        </p>
        <p className="mt-1 flex items-baseline gap-1 text-[28px] font-medium tracking-tight text-text-primary">
          {plan.price}
          <span className="text-[13px] font-normal text-text-subtle">/ mo</span>
        </p>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-text-subtle">
        {plan.detail}
      </p>
    </article>
  );
}
