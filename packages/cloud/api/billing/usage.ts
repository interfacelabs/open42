import { randomUUID } from 'node:crypto';

import { and, eq, gte, sql } from 'drizzle-orm';
import type pino from 'pino';

import type { LlmProvider, LlmScope } from '../../../../apps/api/src/auth/llm-keys.js';
import type { db as defaultDbValue } from '../../../../apps/api/src/db/client.js';
import { db as coreDb, schema as coreSchema } from '../../../../apps/api/src/db/client.js';
import { sanitizeErrorForLog } from '../../../../apps/api/src/middleware/error-sanitize.js';
import { billingUsageEvents, workspaceBilling } from '../schema-cloud.js';
import { getBillingConfig, hasMeterEvent, type BillingConfig } from './config.js';
import { getStripeClient } from './stripe-client.js';

type DbClient = typeof defaultDbValue;
type KeySource = 'tenant' | 'shared';

interface MeterEventClient {
  billing: {
    meterEvents: {
      create(
        params: {
          event_name: string;
          identifier: string;
          payload: Record<string, string>;
          timestamp?: number;
        },
        options?: { idempotencyKey?: string },
      ): Promise<{ identifier: string }>;
    };
  };
}

export interface RecordLlmUsageInput {
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
  keySource: KeySource;
  units?: number;
}

export interface RecordLlmUsageDeps {
  db?: DbClient;
  stripe?: MeterEventClient | null;
  config?: BillingConfig;
  now?: () => Date;
  logger?: Pick<pino.Logger, 'error'>;
}

export interface RetryBillingUsageDeps {
  db?: DbClient;
  stripe?: MeterEventClient | null;
  config?: BillingConfig;
  now?: () => Date;
  logger?: Pick<pino.Logger, 'error' | 'info'>;
  limit?: number;
}

export interface RetryBillingUsageResult {
  scanned: number;
  metered: number;
  failed: number;
  skipped: number;
}

export interface BillingUsageRetryLoopHandle {
  stop(): void;
}

export type RecordLlmUsageResult =
  | {
      status: 'ignored';
      reason: 'tenant_key' | 'invalid_units' | 'workspace_not_found';
    }
  | {
      status: 'ignored';
      reason: 'not_billable';
      usageEventId: string;
      units: number;
      includedUnits: number;
      billableUnits: number;
    }
  | {
      status: 'included' | 'metered' | 'unreported' | 'failed';
      usageEventId: string;
      units: number;
      includedUnits: number;
      billableUnits: number;
    };

export function allocateBillableUnits(input: {
  usedBefore: number;
  incomingUnits: number;
  includedUnits: number;
}): { includedUnits: number; billableUnits: number } {
  const remainingIncluded = Math.max(0, input.includedUnits - input.usedBefore);
  const includedUnits = Math.min(input.incomingUnits, remainingIncluded);
  return {
    includedUnits,
    billableUnits: input.incomingUnits - includedUnits,
  };
}

export function isBillableSubscriptionStatus(status: string | null | undefined): boolean {
  // Keep reporting while Stripe is still retrying collection; product access
  // cutoff for past_due workspaces is a separate policy decision.
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export async function recordLlmUsage(
  input: RecordLlmUsageInput,
  deps: RecordLlmUsageDeps = {},
): Promise<RecordLlmUsageResult> {
  const units = input.units ?? 1;
  if (!Number.isInteger(units) || units <= 0) {
    return { status: 'ignored', reason: 'invalid_units' };
  }
  if (input.keySource === 'tenant') {
    return { status: 'ignored', reason: 'tenant_key' };
  }

  const db = deps.db ?? (await loadDefaultDb());
  const now = deps.now?.() ?? new Date();
  const config = deps.config ?? getBillingConfig();
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  const usageEventId = randomUUID();
  const stripeMeterEventIdentifier = `open42_${usageEventId}`;

  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.workspaceId}))`);

    const [workspace] = await tx
      .select({
        id: coreSchema.workspaces.id,
        stripeCustomerId: workspaceBilling.stripeCustomerId,
        stripeSubscriptionStatus: workspaceBilling.stripeSubscriptionStatus,
        stripeSubscriptionCurrentPeriodStart: workspaceBilling.stripeSubscriptionCurrentPeriodStart,
      })
      .from(coreSchema.workspaces)
      .leftJoin(workspaceBilling, eq(workspaceBilling.workspaceId, coreSchema.workspaces.id))
      .where(eq(coreSchema.workspaces.id, input.workspaceId))
      .limit(1);
    if (!workspace) return null;

    // This uses our last synced Stripe period anchor. During the short window
    // before a Stripe rollover webhook lands, usage can still be allocated
    // against the previous anchor.
    const periodStart = workspace.stripeSubscriptionCurrentPeriodStart ?? startOfUtcMonth(now);
    const [usage] = await tx
      .select({
        used: sql<number>`COALESCE(SUM(${billingUsageEvents.units}), 0)::int`,
      })
      .from(billingUsageEvents)
      .where(
        and(
          eq(billingUsageEvents.workspaceId, input.workspaceId),
          gte(billingUsageEvents.occurredAt, periodStart),
          sql`${billingUsageEvents.status} <> 'ignored'`,
        ),
      );

    const usedBefore = Number(usage?.used ?? 0);
    const allocated = allocateBillableUnits({
      usedBefore,
      incomingUnits: units,
      includedUnits: config.basicIncludedRequests,
    });
    const canReport =
      allocated.billableUnits > 0 &&
      hasMeterEvent(config) &&
      Boolean(stripe) &&
      hasBillableWorkspaceSubscription(workspace);
    const status =
      allocated.billableUnits === 0
        ? 'included'
        : hasBillableWorkspaceSubscription(workspace)
          ? 'unreported'
          : 'ignored';

    await tx.insert(billingUsageEvents).values({
      id: usageEventId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      scope: input.scope,
      keySource: input.keySource,
      units,
      includedUnits: allocated.includedUnits,
      billableUnits: allocated.billableUnits,
      status,
      stripeCustomerId: workspace.stripeCustomerId,
      stripeMeterEventName:
        status !== 'ignored' && allocated.billableUnits > 0 && hasMeterEvent(config)
          ? config.platformRequestMeterEventName
          : null,
      stripeMeterEventIdentifier:
        status !== 'ignored' && allocated.billableUnits > 0 ? stripeMeterEventIdentifier : null,
      occurredAt: now,
    });

    return {
      workspace,
      usageEventId,
      units,
      ...allocated,
      shouldReport: canReport,
    };
  });

  if (!inserted) {
    return { status: 'ignored', reason: 'workspace_not_found' };
  }

  if (inserted.billableUnits > 0 && !hasBillableWorkspaceSubscription(inserted.workspace)) {
    return {
      status: 'ignored',
      reason: 'not_billable',
      usageEventId,
      units,
      includedUnits: inserted.includedUnits,
      billableUnits: inserted.billableUnits,
    };
  }

  if (!inserted.shouldReport || !stripe || !inserted.workspace.stripeCustomerId) {
    return {
      status: inserted.billableUnits === 0 ? 'included' : 'unreported',
      usageEventId,
      units,
      includedUnits: inserted.includedUnits,
      billableUnits: inserted.billableUnits,
    };
  }

  try {
    await stripe.billing.meterEvents.create(
      {
        event_name: config.platformRequestMeterEventName,
        identifier: stripeMeterEventIdentifier,
        payload: {
          stripe_customer_id: inserted.workspace.stripeCustomerId,
          value: String(inserted.billableUnits),
          workspace_id: input.workspaceId,
          provider: input.provider,
          scope: input.scope,
        },
        timestamp: Math.floor(now.getTime() / 1000),
      },
      { idempotencyKey: stripeMeterEventIdentifier },
    );
    await db
      .update(billingUsageEvents)
      .set({ status: 'metered' })
      .where(eq(billingUsageEvents.id, usageEventId));
    return {
      status: 'metered',
      usageEventId,
      units,
      includedUnits: inserted.includedUnits,
      billableUnits: inserted.billableUnits,
    };
  } catch (err) {
    deps.logger?.error(
      {
        err: sanitizeErrorForLog(err),
        workspaceId: input.workspaceId,
        usageEventId,
      },
      'stripe_meter_event_failed',
    );
    await db
      .update(billingUsageEvents)
      .set({
        status: 'failed',
        error: errorMessage(err),
      })
      .where(eq(billingUsageEvents.id, usageEventId));
    return {
      status: 'failed',
      usageEventId,
      units,
      includedUnits: inserted.includedUnits,
      billableUnits: inserted.billableUnits,
    };
  }
}

export async function retryUnreportedBillingUsage(
  deps: RetryBillingUsageDeps = {},
): Promise<RetryBillingUsageResult> {
  const db = deps.db ?? (await loadDefaultDb());
  const config = deps.config ?? getBillingConfig();
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  const limit = deps.limit ?? 100;
  const result: RetryBillingUsageResult = {
    scanned: 0,
    metered: 0,
    failed: 0,
    skipped: 0,
  };

  if (!stripe || !hasMeterEvent(config)) {
    deps.logger?.info(result, 'billing_usage_retry_completed');
    return result;
  }

  await db.transaction(async (tx) => {
    const candidates = rowsOf<RetryCandidate>(
      await tx.execute(sql`
        SELECT
          e.id,
          e.workspace_id AS "workspaceId",
          e.provider,
          e.scope,
          e.billable_units AS "billableUnits",
          e.stripe_meter_event_identifier AS "stripeMeterEventIdentifier",
          e.occurred_at AS "occurredAt",
          b.stripe_customer_id AS "stripeCustomerId",
          b.stripe_subscription_status AS "stripeSubscriptionStatus"
        FROM billing_usage_events e
        INNER JOIN workspace_billing b ON b.workspace_id = e.workspace_id
        WHERE e.status IN ('failed'::billing_usage_status, 'unreported'::billing_usage_status)
          AND e.billable_units > 0
          AND e.stripe_meter_event_identifier IS NOT NULL
          AND b.stripe_customer_id IS NOT NULL
          AND b.stripe_subscription_current_period_start IS NOT NULL
          AND e.occurred_at >= b.stripe_subscription_current_period_start
        ORDER BY e.occurred_at
        LIMIT ${limit}
        FOR UPDATE OF e SKIP LOCKED
      `),
    );
    result.scanned = candidates.length;
    for (const candidate of candidates) {
      const eventName = config.platformRequestMeterEventName;
      if (
        !candidate.stripeCustomerId ||
        !candidate.stripeMeterEventIdentifier ||
        !isBillableSubscriptionStatus(candidate.stripeSubscriptionStatus)
      ) {
        result.skipped += 1;
        continue;
      }

      try {
        await stripe.billing.meterEvents.create(
          {
            event_name: eventName,
            identifier: candidate.stripeMeterEventIdentifier,
            payload: {
              stripe_customer_id: candidate.stripeCustomerId,
              value: String(candidate.billableUnits),
              workspace_id: candidate.workspaceId,
              provider: candidate.provider,
              scope: candidate.scope,
            },
            timestamp: Math.floor(candidate.occurredAt.getTime() / 1000),
          },
          { idempotencyKey: candidate.stripeMeterEventIdentifier },
        );
        await tx
          .update(billingUsageEvents)
          .set({
            status: 'metered',
            stripeCustomerId: candidate.stripeCustomerId,
            stripeMeterEventName: eventName,
            error: null,
          })
          .where(eq(billingUsageEvents.id, candidate.id));
        result.metered += 1;
      } catch (err) {
        deps.logger?.error(
          {
            err: sanitizeErrorForLog(err),
            workspaceId: candidate.workspaceId,
            usageEventId: candidate.id,
          },
          'stripe_meter_event_retry_failed',
        );
        await tx
          .update(billingUsageEvents)
          .set({
            status: 'failed',
            stripeCustomerId: candidate.stripeCustomerId,
            stripeMeterEventName: eventName,
            error: errorMessage(err),
          })
          .where(eq(billingUsageEvents.id, candidate.id));
        result.failed += 1;
      }
    }
  });
  deps.logger?.info(result, 'billing_usage_retry_completed');
  return result;
}

export function startBillingUsageRetryLoop(
  options: {
    intervalMs?: number;
    limit?: number;
    logger?: Pick<pino.Logger, 'error' | 'info'>;
  } = {},
): BillingUsageRetryLoopHandle {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  const run = () => {
    void retryUnreportedBillingUsage({
      limit: options.limit,
      logger: options.logger,
    }).catch((err) => {
      options.logger?.error({ err: sanitizeErrorForLog(err) }, 'billing_usage_retry_loop_failed');
    });
  };
  const handle = setInterval(run, intervalMs);
  handle.unref?.();
  run();
  return {
    stop() {
      clearInterval(handle);
    },
  };
}

interface RetryCandidate {
  id: string;
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
  billableUnits: number;
  stripeMeterEventIdentifier: string | null;
  occurredAt: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
}

function hasBillableWorkspaceSubscription(workspace: {
  stripeCustomerId: string | null;
  stripeSubscriptionStatus: string | null;
}): boolean {
  return (
    Boolean(workspace.stripeCustomerId) &&
    isBillableSubscriptionStatus(workspace.stripeSubscriptionStatus)
  );
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 240);
  return String(err).slice(0, 240);
}

async function loadDefaultDb(): Promise<DbClient> {
  return coreDb;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
