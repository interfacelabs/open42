import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { llmProviderEnum, llmScopeEnum, workspaces } from '@open42/api/db/schema';

export const workspaceBillingModeEnum = pgEnum('workspace_billing_mode', ['platform', 'byok']);
export const billingUsageStatusEnum = pgEnum('billing_usage_status', [
  'included',
  'metered',
  'unreported',
  'failed',
  'ignored',
]);

export const workspaceBilling = pgTable(
  'workspace_billing',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planKey: text('plan_key').notNull().default('basic'),
    mode: workspaceBillingModeEnum('mode').notNull().default('platform'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodStart: timestamp('stripe_subscription_current_period_start', {
      withTimezone: true,
    }),
    stripeSubscriptionCurrentPeriodEnd: timestamp('stripe_subscription_current_period_end', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId] }),
    stripeCustomerUniq: uniqueIndex('workspace_billing_stripe_customer_id_uniq')
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} IS NOT NULL`),
    stripeSubscriptionUniq: uniqueIndex('workspace_billing_stripe_subscription_id_uniq')
      .on(t.stripeSubscriptionId)
      .where(sql`${t.stripeSubscriptionId} IS NOT NULL`),
  }),
);

export const billingUsageEvents = pgTable(
  'billing_usage_events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: llmProviderEnum('provider').notNull(),
    scope: llmScopeEnum('scope').notNull(),
    keySource: text('key_source').notNull(),
    units: integer('units').notNull().default(1),
    includedUnits: integer('included_units').notNull().default(0),
    billableUnits: integer('billable_units').notNull().default(0),
    status: billingUsageStatusEnum('status').notNull(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeMeterEventName: text('stripe_meter_event_name'),
    stripeMeterEventIdentifier: text('stripe_meter_event_identifier'),
    error: text('error'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceOccurredIdx: index('billing_usage_events_workspace_occurred_idx').on(
      t.workspaceId,
      t.occurredAt,
    ),
    workspaceStatusIdx: index('billing_usage_events_workspace_status_idx').on(
      t.workspaceId,
      t.status,
    ),
    stripeMeterIdentifierUniq: uniqueIndex('billing_usage_events_stripe_meter_identifier_uniq')
      .on(t.stripeMeterEventIdentifier)
      .where(sql`${t.stripeMeterEventIdentifier} IS NOT NULL`),
    unitsCheck: check('billing_usage_events_units_positive', sql`${t.units} > 0`),
    includedUnitsCheck: check(
      'billing_usage_events_included_units_nonnegative',
      sql`${t.includedUnits} >= 0`,
    ),
    billableUnitsCheck: check(
      'billing_usage_events_billable_units_nonnegative',
      sql`${t.billableUnits} >= 0`,
    ),
    keySourceCheck: check(
      'billing_usage_events_key_source_check',
      sql`${t.keySource} IN ('tenant', 'shared')`,
    ),
  }),
);

export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    processedAtIdx: index('stripe_webhook_events_processed_at_idx').on(t.processedAt),
  }),
);

export const cloudWaitlistEntries = pgTable(
  'cloud_waitlist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    source: text('source').notNull().default('landing'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex('cloud_waitlist_entries_email_uniq').on(t.email),
    createdAtIdx: index('cloud_waitlist_entries_created_at_idx').on(t.createdAt),
  }),
);

export const cloudSchema = {
  workspaceBilling,
  billingUsageEvents,
  stripeWebhookEvents,
  cloudWaitlistEntries,
};

export type WorkspaceBilling = typeof workspaceBilling.$inferSelect;
export type BillingUsageEvent = typeof billingUsageEvents.$inferSelect;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type CloudWaitlistEntry = typeof cloudWaitlistEntries.$inferSelect;
