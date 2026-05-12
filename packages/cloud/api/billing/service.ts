import { and, eq, gte, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

import { db as defaultDb, schema as coreSchema } from '@open42/api/db/client';
import { billingUsageEvents, workspaceBilling } from '../schema-cloud.js';
import {
  billingModeLabel,
  getBillingConfig,
  hasBasePrice,
  hasOverageMeter,
  parseBillingMode,
  type BillingConfig,
  type BillingMode,
} from './config.js';
import { getStripeClient } from './stripe-client.js';

export class BillingError extends Error {
  constructor(
    public readonly code:
      | 'stripe_not_configured'
      | 'base_price_not_configured'
      | 'metered_price_not_configured'
      | 'workspace_not_found'
      | 'subscription_exists'
      | 'stripe_customer_missing'
      | 'byok_key_required',
    message = code,
  ) {
    super(message);
  }
}

interface StripeClient {
  customers: {
    create(
      params: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ url: string }>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
  };
}

export interface BillingDeps {
  db?: typeof defaultDb;
  stripe?: StripeClient | null;
  config?: BillingConfig;
  now?: () => Date;
}

export async function getWorkspaceBilling(workspaceId: string, deps: BillingDeps = {}) {
  const db = deps.db ?? defaultDb;
  const config = deps.config ?? getBillingConfig();
  const now = deps.now?.() ?? new Date();

  const [workspace] = await db
    .select({
      id: coreSchema.workspaces.id,
      name: coreSchema.workspaces.name,
      planKey: workspaceBilling.planKey,
      mode: workspaceBilling.mode,
      stripeCustomerId: workspaceBilling.stripeCustomerId,
      stripeSubscriptionId: workspaceBilling.stripeSubscriptionId,
      stripeSubscriptionStatus: workspaceBilling.stripeSubscriptionStatus,
      stripeSubscriptionCurrentPeriodStart: workspaceBilling.stripeSubscriptionCurrentPeriodStart,
      stripeSubscriptionCurrentPeriodEnd: workspaceBilling.stripeSubscriptionCurrentPeriodEnd,
    })
    .from(coreSchema.workspaces)
    .leftJoin(workspaceBilling, eq(workspaceBilling.workspaceId, coreSchema.workspaces.id))
    .where(eq(coreSchema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new BillingError('workspace_not_found');

  const periodStart = workspace.stripeSubscriptionCurrentPeriodStart ?? startOfUtcMonth(now);
  const [usage] = await db
    .select({
      used: sql<number>`COALESCE(SUM(${billingUsageEvents.units}), 0)::int`,
      metered: sql<number>`COALESCE(SUM(${billingUsageEvents.billableUnits}), 0)::int`,
    })
    .from(billingUsageEvents)
    .where(
      and(
        eq(billingUsageEvents.workspaceId, workspaceId),
        gte(billingUsageEvents.occurredAt, periodStart),
        sql`${billingUsageEvents.status} <> 'ignored'`,
      ),
    );
  const [credential] = await db
    .select({ id: coreSchema.workspaceCredentials.id })
    .from(coreSchema.workspaceCredentials)
    .where(eq(coreSchema.workspaceCredentials.workspaceId, workspaceId))
    .limit(1);

  const usedRequests = Number(usage?.used ?? 0);
  const meteredRequests = Number(usage?.metered ?? 0);
  const includedRequestsRemaining = Math.max(0, config.basicIncludedRequests - usedRequests);

  return {
    billing: {
      planKey: workspace.planKey ?? 'basic',
      planName: 'Basic',
      mode: workspace.mode ?? 'platform',
      modeLabel: billingModeLabel(workspace.mode ?? 'platform'),
      hasByokKeys: Boolean(credential),
      subscriptionStatus: workspace.stripeSubscriptionStatus,
      subscriptionActive: isSubscriptionUsable(workspace.stripeSubscriptionStatus),
      hasStripeCustomer: Boolean(workspace.stripeCustomerId),
      hasStripeSubscription: Boolean(workspace.stripeSubscriptionId),
      currentPeriodStart: periodStart.toISOString(),
      currentPeriodEnd: workspace.stripeSubscriptionCurrentPeriodEnd?.toISOString() ?? null,
      includedRequests: config.basicIncludedRequests,
      usedRequests,
      includedRequestsRemaining,
      meteredRequests,
      checkoutConfigured: hasBasePrice(config),
      overageMeterConfigured: hasOverageMeter(config),
      portalAvailable: Boolean(workspace.stripeCustomerId),
    },
  };
}

export async function createCheckoutSession(
  input: {
    workspaceId: string;
    userId: string;
    billingMode: BillingMode;
  },
  deps: BillingDeps = {},
): Promise<{ url: string }> {
  const db = deps.db ?? defaultDb;
  const config = deps.config ?? getBillingConfig();
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  if (!stripe) throw new BillingError('stripe_not_configured');
  if (!hasBasePrice(config)) throw new BillingError('base_price_not_configured');
  if (input.billingMode === 'platform' && !hasOverageMeter(config)) {
    throw new BillingError('metered_price_not_configured');
  }

  const [row] = await db
    .select({
      workspaceId: coreSchema.workspaces.id,
      workspaceName: coreSchema.workspaces.name,
      ownerUserId: coreSchema.workspaces.ownerUserId,
      ownerEmail: coreSchema.users.email,
      stripeCustomerId: workspaceBilling.stripeCustomerId,
      stripeSubscriptionStatus: workspaceBilling.stripeSubscriptionStatus,
    })
    .from(coreSchema.workspaces)
    .innerJoin(coreSchema.users, eq(coreSchema.users.id, coreSchema.workspaces.ownerUserId))
    .leftJoin(workspaceBilling, eq(workspaceBilling.workspaceId, coreSchema.workspaces.id))
    .where(eq(coreSchema.workspaces.id, input.workspaceId))
    .limit(1);
  if (!row) throw new BillingError('workspace_not_found');
  if (isSubscriptionUsable(row.stripeSubscriptionStatus)) {
    throw new BillingError('subscription_exists');
  }
  if (input.billingMode === 'byok') {
    const [credential] = await db
      .select({ id: coreSchema.workspaceCredentials.id })
      .from(coreSchema.workspaceCredentials)
      .where(eq(coreSchema.workspaceCredentials.workspaceId, input.workspaceId))
      .limit(1);
    if (!credential) throw new BillingError('byok_key_required');
  }

  const customerId =
    row.stripeCustomerId ??
    (
      await stripe.customers.create(
        {
          email: row.ownerEmail,
          name: row.workspaceName,
          metadata: {
            workspace_id: row.workspaceId,
            owner_user_id: row.ownerUserId,
          },
        },
        { idempotencyKey: `open42_workspace_customer_${row.workspaceId}` },
      )
    ).id;

  if (!row.stripeCustomerId) {
    await upsertWorkspaceBilling(input.workspaceId, { stripeCustomerId: customerId }, db);
  }

  const lineItems: Array<{ price: string; quantity?: number }> = [
    { price: config.basicMonthlyPriceId, quantity: 1 },
  ];
  if (config.platformRequestMeteredPriceId) {
    lineItems.push({ price: config.platformRequestMeteredPriceId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: input.workspaceId,
    line_items: lineItems,
    allow_promotion_codes: true,
    success_url: `${config.webPublicUrl}/settings/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webPublicUrl}/settings/plan?checkout=cancelled`,
    metadata: {
      workspace_id: input.workspaceId,
      owner_user_id: input.userId,
      billing_mode: input.billingMode,
      plan_key: 'basic',
    },
    subscription_data: {
      billing_mode: { type: 'flexible' },
      metadata: {
        workspace_id: input.workspaceId,
        owner_user_id: input.userId,
        billing_mode: input.billingMode,
        plan_key: 'basic',
      },
    },
  });

  if (!session.url) throw new BillingError('stripe_not_configured');
  return { url: session.url };
}

export async function createPortalSession(
  workspaceId: string,
  deps: BillingDeps = {},
): Promise<{ url: string }> {
  const db = deps.db ?? defaultDb;
  const config = deps.config ?? getBillingConfig();
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  if (!stripe) throw new BillingError('stripe_not_configured');

  const [workspace] = await db
    .select({ stripeCustomerId: workspaceBilling.stripeCustomerId })
    .from(coreSchema.workspaces)
    .leftJoin(workspaceBilling, eq(workspaceBilling.workspaceId, coreSchema.workspaces.id))
    .where(eq(coreSchema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new BillingError('workspace_not_found');
  if (!workspace.stripeCustomerId) throw new BillingError('stripe_customer_missing');

  const session = await stripe.billingPortal.sessions.create({
    customer: workspace.stripeCustomerId,
    return_url: `${config.webPublicUrl}/settings/plan`,
  });
  return { url: session.url };
}

export async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
  deps: BillingDeps = {},
): Promise<void> {
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  const workspaceId = session.metadata?.workspace_id ?? session.client_reference_id;
  if (!workspaceId) return;

  const customerId = stringId(session.customer);
  const subscriptionId = stringId(session.subscription);
  if (subscriptionId && stripe) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription, deps);
    return;
  }

  const db = deps.db ?? defaultDb;
  await upsertWorkspaceBilling(
    workspaceId,
    {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
    },
    db,
  );
}

export async function syncSubscription(
  subscription: Stripe.Subscription,
  deps: BillingDeps = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;
  const config = deps.config ?? getBillingConfig();
  const workspaceId = subscription.metadata?.workspace_id;
  const customerId = stringId(subscription.customer);
  const period = subscriptionPeriod(subscription, config);
  const billingMode = parseBillingMode(subscription.metadata?.billing_mode);

  const set = {
    stripeCustomerId: customerId ?? undefined,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeSubscriptionCurrentPeriodStart: period.start,
    stripeSubscriptionCurrentPeriodEnd: period.end,
    mode: billingMode ?? undefined,
    planKey: subscription.metadata?.plan_key || 'basic',
  };

  if (workspaceId) {
    await upsertWorkspaceBilling(workspaceId, set, db);
    return;
  }
  if (customerId) {
    await db
      .update(workspaceBilling)
      .set(set)
      .where(eq(workspaceBilling.stripeCustomerId, customerId));
  }
}

export function isSubscriptionUsable(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export function mapBillingErrorStatus(error: BillingError): number {
  switch (error.code) {
    case 'workspace_not_found':
      return 404;
    case 'subscription_exists':
    case 'stripe_customer_missing':
    case 'byok_key_required':
      return 409;
    case 'stripe_not_configured':
    case 'base_price_not_configured':
    case 'metered_price_not_configured':
      return 503;
    default: {
      const _exhaustive: never = error.code;
      void _exhaustive;
      return 500;
    }
  }
}

async function upsertWorkspaceBilling(
  workspaceId: string,
  values: Partial<typeof workspaceBilling.$inferInsert>,
  db: typeof defaultDb,
): Promise<void> {
  await db
    .insert(workspaceBilling)
    .values({
      workspaceId,
      ...values,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceBilling.workspaceId,
      set: {
        ...values,
        updatedAt: new Date(),
      },
    });
}

function subscriptionPeriod(
  subscription: Stripe.Subscription,
  config: BillingConfig,
): { start: Date | null; end: Date | null } {
  const baseItem =
    subscription.items.data.find((item) => item.price.id === config.basicMonthlyPriceId) ??
    subscription.items.data[0];
  const billingCycleAnchor =
    typeof subscription.billing_cycle_anchor === 'number' && subscription.billing_cycle_anchor > 0
      ? subscription.billing_cycle_anchor
      : null;

  return {
    start:
      typeof baseItem?.current_period_start === 'number'
        ? new Date(baseItem.current_period_start * 1000)
        : billingCycleAnchor
          ? new Date(billingCycleAnchor * 1000)
          : null,
    end:
      typeof baseItem?.current_period_end === 'number'
        ? new Date(baseItem.current_period_end * 1000)
        : null,
  };
}

function stringId(value: string | { id?: string } | null | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
