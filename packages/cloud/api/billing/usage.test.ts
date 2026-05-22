import { describe, expect, it, vi } from 'vitest';

import {
  allocateBillableUnits,
  isBillableSubscriptionStatus,
  recordLlmUsage,
  retryUnreportedBillingUsage,
} from './usage.js';

describe('billing usage allocation', () => {
  it('keeps shared-key requests inside the included allowance before overage', () => {
    expect(
      allocateBillableUnits({
        usedBefore: 10,
        incomingUnits: 5,
        includedUnits: 20,
      }),
    ).toEqual({ includedUnits: 5, billableUnits: 0 });
  });

  it('splits a request batch across included and metered usage', () => {
    expect(
      allocateBillableUnits({
        usedBefore: 18,
        incomingUnits: 5,
        includedUnits: 20,
      }),
    ).toEqual({ includedUnits: 2, billableUnits: 3 });
  });

  it('meters everything after the included allowance is consumed', () => {
    expect(
      allocateBillableUnits({
        usedBefore: 20,
        incomingUnits: 4,
        includedUnits: 20,
      }),
    ).toEqual({ includedUnits: 0, billableUnits: 4 });
  });

  it('only reports usage for subscriptions that can still be billed', () => {
    expect(isBillableSubscriptionStatus('active')).toBe(true);
    expect(isBillableSubscriptionStatus('trialing')).toBe(true);
    expect(isBillableSubscriptionStatus('past_due')).toBe(true);
    expect(isBillableSubscriptionStatus('canceled')).toBe(false);
    expect(isBillableSubscriptionStatus(null)).toBe(false);
  });

  it('marks pre-subscription overage ignored so it cannot be backbilled later', async () => {
    const inserted: unknown[] = [];
    let selectCount = 0;
    const tx = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              leftJoin: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      id: 'workspace-1',
                      stripeCustomerId: null,
                      stripeSubscriptionStatus: null,
                      stripeSubscriptionCurrentPeriodStart: null,
                    },
                  ],
                }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: async () => [{ used: 0 }],
          }),
        };
      }),
      insert: () => ({
        values: async (value: unknown) => {
          inserted.push(value);
        },
      }),
    };
    const db = {
      transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await recordLlmUsage(
      {
        workspaceId: 'workspace-1',
        provider: 'anthropic',
        scope: 'chat',
        keySource: 'shared',
        units: 1,
      },
      {
        db: db as never,
        stripe: null,
        config: {
          stripeSecretKey: 'sk_test',
          webPublicUrl: 'http://localhost:3000',
          basicMonthlyPriceId: 'price_base',
          platformRequestMeteredPriceId: 'price_metered',
          platformRequestMeterEventName: 'open42_request',
          basicIncludedRequests: 0,
          upgradesEnabled: true,
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ignored',
        reason: 'not_billable',
        billableUnits: 1,
      }),
    );
    expect(inserted).toContainEqual(
      expect.objectContaining({
        status: 'ignored',
        billableUnits: 1,
        stripeMeterEventIdentifier: null,
      }),
    );
  });

  it('retries failed or unreported metered usage with the saved idempotency identifier', async () => {
    const updates: unknown[] = [];
    const tx = {
      execute: vi.fn(async () => ({
        rows: [
          {
            id: 'usage-1',
            workspaceId: 'workspace-1',
            provider: 'anthropic',
            scope: 'chat',
            billableUnits: 3,
            stripeMeterEventIdentifier: 'open42_usage_1',
            occurredAt: new Date('2026-05-12T10:00:00.000Z'),
            stripeCustomerId: 'cus_123',
            stripeSubscriptionStatus: 'active',
          },
        ],
      })),
      update: () => ({
        set: (value: unknown) => {
          updates.push(value);
          return { where: async () => undefined };
        },
      }),
    };
    const db = {
      transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const create = vi.fn(async () => ({ identifier: 'open42_usage_1' }));
    const logger = { error: vi.fn(), info: vi.fn() };

    const result = await retryUnreportedBillingUsage({
      db: db as never,
      stripe: { billing: { meterEvents: { create } } },
      logger,
      config: {
        stripeSecretKey: 'sk_test',
        webPublicUrl: 'http://localhost:3000',
        basicMonthlyPriceId: 'price_base',
        platformRequestMeteredPriceId: 'price_metered',
        platformRequestMeterEventName: 'open42_request',
        basicIncludedRequests: 10,
        upgradesEnabled: true,
      },
    });

    expect(result).toEqual({ scanned: 1, metered: 1, failed: 0, skipped: 0 });
    expect(tx.execute).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'open42_request',
        identifier: 'open42_usage_1',
        payload: expect.objectContaining({
          stripe_customer_id: 'cus_123',
          value: '3',
          workspace_id: 'workspace-1',
        }),
      }),
      { idempotencyKey: 'open42_usage_1' },
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        status: 'metered',
        stripeCustomerId: 'cus_123',
        stripeMeterEventName: 'open42_request',
        error: null,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(result, 'billing_usage_retry_completed');
  });
});
