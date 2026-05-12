import { and, eq, isNull, lt, or } from 'drizzle-orm';

import { db as defaultDb } from '@open42/api/db/client';
import { stripeWebhookEvents } from '../schema-cloud.js';

// A crashed worker can delay duplicate Stripe deliveries until this lease
// expires. Stripe retries webhooks with backoff, so this favors duplicate
// safety over immediate reprocessing after process death.
const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

type DbClient = typeof defaultDb;

export type StripeWebhookClaim =
  | { status: 'claimed' }
  | { status: 'duplicate' }
  | { status: 'in_progress' };

export interface StripeWebhookEventDeps {
  db?: DbClient;
  now?: () => Date;
}

export async function claimStripeWebhookEvent(
  event: { id: string; type: string },
  deps: StripeWebhookEventDeps = {},
): Promise<StripeWebhookClaim> {
  const db = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const [inserted] = await db
    .insert(stripeWebhookEvents)
    .values({
      id: event.id,
      type: event.type,
      processingStartedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });
  if (inserted) return { status: 'claimed' };

  const [existing] = await db
    .select({
      processedAt: stripeWebhookEvents.processedAt,
      processingStartedAt: stripeWebhookEvents.processingStartedAt,
    })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.id, event.id))
    .limit(1);
  if (!existing) return { status: 'in_progress' };
  if (existing.processedAt) return { status: 'duplicate' };

  const staleBefore = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
  const [claimed] = await db
    .update(stripeWebhookEvents)
    .set({
      processingStartedAt: now,
      error: null,
    })
    .where(
      and(
        eq(stripeWebhookEvents.id, event.id),
        isNull(stripeWebhookEvents.processedAt),
        or(
          isNull(stripeWebhookEvents.processingStartedAt),
          lt(stripeWebhookEvents.processingStartedAt, staleBefore),
        ),
      ),
    )
    .returning({ id: stripeWebhookEvents.id });
  return claimed ? { status: 'claimed' } : { status: 'in_progress' };
}

export async function markStripeWebhookEventProcessed(
  eventId: string,
  deps: StripeWebhookEventDeps = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;
  await db
    .update(stripeWebhookEvents)
    .set({
      processedAt: deps.now?.() ?? new Date(),
      processingStartedAt: null,
      error: null,
    })
    .where(eq(stripeWebhookEvents.id, eventId));
}

export async function markStripeWebhookEventFailed(
  eventId: string,
  err: unknown,
  deps: StripeWebhookEventDeps = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;
  await db
    .update(stripeWebhookEvents)
    .set({
      processingStartedAt: null,
      error: errorMessage(err),
    })
    .where(eq(stripeWebhookEvents.id, eventId));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 240);
  return String(err).slice(0, 240);
}
