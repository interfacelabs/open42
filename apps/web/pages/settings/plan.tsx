import Head from 'next/head';
import { useRouter } from 'next/router';
import { CreditCard, ExternalLink, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/PageHeader';
import { SettingsNav } from '@/components/SettingsNav';
import { Button } from '@/components/ui/button';
import { csrfHeaders } from '@/lib/csrf';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/lib/workspaces/store';

type BillingMode = 'platform' | 'byok';

interface BillingPayload {
  billing: {
    planKey: string;
    planName: string;
    mode: BillingMode;
    modeLabel: string;
    hasByokKeys: boolean;
    subscriptionStatus: string | null;
    subscriptionActive: boolean;
    hasStripeCustomer: boolean;
    hasStripeSubscription: boolean;
    currentPeriodStart: string;
    currentPeriodEnd: string | null;
    includedRequests: number;
    usedRequests: number;
    includedRequestsRemaining: number;
    meteredRequests: number;
    checkoutConfigured: boolean;
    overageMeterConfigured: boolean;
    portalAvailable: boolean;
  };
}

const fetcher = async (url: string): Promise<BillingPayload> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('fetch_failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

export default function PlanSettingsPage() {
  const router = useRouter();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const billingUrl = workspaceId
    ? `/api/workspaces/${encodeURIComponent(workspaceId)}/billing`
    : null;
  const { data, error, mutate } = useSWR<BillingPayload>(billingUrl, fetcher);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const checkoutStatus = checkoutStatusFromQuery(router.query.checkout);

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace('/sign_in');
    }
  }, [error, router]);

  useEffect(() => {
    if (checkoutStatus === 'success') void mutate();
  }, [checkoutStatus, mutate]);

  async function postBillingAction(path: 'checkout' | 'portal', billingMode?: BillingMode) {
    if (!workspaceId) return;
    setActionError(null);
    setPendingAction(path === 'checkout' ? (billingMode ?? 'platform') : 'portal');
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/billing/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify(billingMode ? { billingMode } : {}),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !payload.url) {
        setActionError(actionErrorCopy(payload.error, res.status));
        setPendingAction(null);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setActionError('Could not reach Stripe. Try again.');
      setPendingAction(null);
    }
  }

  const isForbidden = (error as { status?: number } | undefined)?.status === 403;
  const billing = data?.billing ?? null;

  return (
    <>
      <Head>
        <title>Billing — Open42</title>
      </Head>
      <AppShell>
        <PageHeader
          breadcrumb="SETTINGS · BILLING"
          title="Billing"
          subtitle="Workspace subscription and shared-key usage."
        />
        <SettingsNav active="plan" />

        <div className="flex-1 overflow-auto px-5 py-8 md:px-10 md:py-10">
          <div className="max-w-4xl">
            {isForbidden ? (
              <div
                role="alert"
                className="rounded-xl border border-border bg-panel-soft px-5 py-4 text-[13.5px] text-text-body"
              >
                Only workspace owners can manage billing.
              </div>
            ) : billing ? (
              <div className="space-y-6">
                {checkoutStatus ? <CheckoutNotice status={checkoutStatus} /> : null}
                <BillingSummary billing={billing} onRefresh={() => mutate()} />
                <UsagePanel billing={billing} />
                <BillingActions
                  billing={billing}
                  pendingAction={pendingAction}
                  actionError={actionError}
                  onCheckout={(mode) => postBillingAction('checkout', mode)}
                  onPortal={() => postBillingAction('portal')}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-border-soft bg-white p-6 text-[13px] text-text-subtle">
                Loading billing.
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}

function CheckoutNotice({ status }: { status: 'success' | 'cancelled' }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border px-5 py-4 text-[13.5px]',
        status === 'success'
          ? 'border-blue-line bg-blue-soft text-blue'
          : 'border-border bg-panel-soft text-text-body',
      )}
    >
      {status === 'success'
        ? 'Stripe checkout completed. Billing status will refresh when Stripe confirms the subscription.'
        : 'Stripe checkout was cancelled.'}
    </div>
  );
}

function BillingSummary({
  billing,
  onRefresh,
}: {
  billing: BillingPayload['billing'];
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-xl border border-border-soft bg-white p-6 shadow-card">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="neutral">{billing.planName}</Tag>
            <Tag tone={billing.subscriptionActive ? 'success' : 'warn'}>
              {billing.subscriptionStatus ?? 'not subscribed'}
            </Tag>
            {billing.subscriptionActive ? (
              <Tag tone={billing.mode === 'byok' ? 'neutral' : 'success'}>{billing.modeLabel}</Tag>
            ) : null}
          </div>
          <h2 className="mt-4 text-[20px] font-medium tracking-tight text-text-primary">
            Workspace billing
          </h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-text-subtle">
            The base subscription is monthly. Shared Open42 key usage counts toward the included
            request allowance before overage is reported to Stripe.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
    </section>
  );
}

function UsagePanel({ billing }: { billing: BillingPayload['billing'] }) {
  const used = billing.usedRequests;
  const included = billing.includedRequests;
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 100;
  const periodCopy = billing.currentPeriodEnd
    ? `Current billing period starts ${formatDate(billing.currentPeriodStart)} and ends ${formatDate(
        billing.currentPeriodEnd,
      )}.`
    : `Usage tracking window starts ${formatDate(billing.currentPeriodStart)}.`;
  return (
    <section className="rounded-xl border border-border-soft bg-white p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[15px] font-medium text-text-primary">
            Shared-key request allowance
          </h2>
          <p className="mt-1 text-[13px] text-text-subtle">{periodCopy}</p>
        </div>
        <div className="font-mono text-[12px] text-text-subtle">
          {billing.includedRequestsRemaining.toLocaleString()} included left
        </div>
      </div>

      <div className="mt-5 h-2 rounded-full bg-panel-soft">
        <div
          className="h-2 w-full origin-left rounded-full bg-blue transition-transform duration-200"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Included" value={included.toLocaleString()} />
        <Metric label="Used" value={used.toLocaleString()} />
        <Metric label="Metered" value={billing.meteredRequests.toLocaleString()} />
      </dl>
    </section>
  );
}

function BillingActions({
  billing,
  pendingAction,
  actionError,
  onCheckout,
  onPortal,
}: {
  billing: BillingPayload['billing'];
  pendingAction: string | null;
  actionError: string | null;
  onCheckout: (mode: BillingMode) => void;
  onPortal: () => void;
}) {
  const busy = pendingAction !== null;
  const baseCheckoutDisabled = !billing.checkoutConfigured || busy;
  const platformCheckoutDisabled =
    !billing.checkoutConfigured || !billing.overageMeterConfigured || busy;
  const byokCheckoutDisabled = baseCheckoutDisabled || !billing.hasByokKeys;

  return (
    <section className="space-y-3">
      <BillingOption
        icon={<CreditCard className="h-4 w-4" strokeWidth={1.5} />}
        title="Open42 keys"
        body="Monthly base plan with included shared-key requests, then request overage billing."
        active={billing.subscriptionActive && billing.mode === 'platform'}
        disabled={platformCheckoutDisabled}
        button={
          billing.subscriptionActive ? (
            <PortalButton disabled={!billing.portalAvailable || busy} onClick={onPortal}>
              {pendingAction === 'portal' ? 'Opening...' : 'Manage'}
            </PortalButton>
          ) : (
            <Button
              size="sm"
              disabled={platformCheckoutDisabled}
              onClick={() => onCheckout('platform')}
            >
              {pendingAction === 'platform' ? 'Opening...' : 'Subscribe'}
            </Button>
          )
        }
      />

      <BillingOption
        icon={<KeyRound className="h-4 w-4" strokeWidth={1.5} />}
        title="BYOK"
        body="Use workspace provider keys; overage is not reported unless a request falls back to Open42 keys."
        active={billing.subscriptionActive && billing.mode === 'byok'}
        disabled={byokCheckoutDisabled}
        button={
          billing.subscriptionActive ? (
            <PortalButton disabled={!billing.portalAvailable || busy} onClick={onPortal}>
              {pendingAction === 'portal' ? 'Opening...' : 'Manage'}
            </PortalButton>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={byokCheckoutDisabled}
              onClick={() => onCheckout('byok')}
            >
              {pendingAction === 'byok' ? 'Opening...' : 'Subscribe'}
            </Button>
          )
        }
      />

      {!billing.checkoutConfigured ? (
        <p className="text-[12.5px] text-destructive">
          Stripe is missing STRIPE_SECRET_KEY or STRIPE_BASIC_MONTHLY_PRICE_ID.
        </p>
      ) : !billing.overageMeterConfigured ? (
        <p className="text-[12.5px] text-text-subtle">
          Overage price is not configured yet; Open42-key checkout is disabled, and BYOK can still
          use the base monthly plan.
        </p>
      ) : null}

      {billing.checkoutConfigured && !billing.hasByokKeys ? (
        <p className="text-[12.5px] text-text-subtle">
          Add a workspace provider key before subscribing to BYOK.
        </p>
      ) : null}

      {actionError ? (
        <p className="text-[12.5px] text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}

function BillingOption({
  icon,
  title,
  body,
  active,
  disabled,
  button,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  active: boolean;
  disabled: boolean;
  button: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-center sm:justify-between',
        active ? 'border-blue-line shadow-card' : 'border-border-soft',
        disabled && 'opacity-80',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-panel-soft text-text-body">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-medium text-text-primary">{title}</h3>
            {active ? <Tag tone="success">Selected</Tag> : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-subtle">{body}</p>
        </div>
      </div>
      <div className="shrink-0">{button}</div>
    </article>
  );
}

function PortalButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={disabled} onClick={onClick}>
      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
      {children}
    </Button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-panel-soft p-4">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint">
        {label}
      </dt>
      <dd className="mt-1 text-[20px] font-medium tracking-tight text-text-primary">{value}</dd>
    </div>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warn';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]',
        tone === 'neutral' && 'bg-panel-soft text-text-subtle',
        tone === 'success' && 'bg-blue-soft text-blue',
        tone === 'warn' && 'bg-orange-soft text-orange',
      )}
    >
      {children}
    </span>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function actionErrorCopy(error: string | undefined, status: number): string {
  if (error === 'subscription_exists') return 'This workspace already has a subscription.';
  if (error === 'byok_key_required')
    return 'Add a workspace provider key before subscribing to BYOK.';
  if (error === 'metered_price_not_configured') {
    return 'Stripe overage price is not configured for Open42-key billing.';
  }
  if (error === 'base_price_not_configured' || error === 'stripe_not_configured') {
    return 'Stripe is not configured for this environment.';
  }
  if (status === 401) return 'Sign in required.';
  if (status === 403) return 'Only workspace owners can manage billing.';
  return 'Could not open Stripe. Try again.';
}

function checkoutStatusFromQuery(value: unknown): 'success' | 'cancelled' | null {
  if (value === 'success' || value === 'cancelled') return value;
  return null;
}
