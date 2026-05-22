import { describe, expect, it } from 'vitest';

import { getBillingConfig, hasCheckoutConfigured } from './config.js';

describe('billing config', () => {
  it('keeps checkout unavailable when paid upgrades are disabled', () => {
    const config = getBillingConfig({
      WEB_PUBLIC_URL: 'https://app.open42.ai',
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_BASIC_MONTHLY_PRICE_ID: 'price_basic',
      OPEN42_BILLING_UPGRADES_ENABLED: 'false',
    });

    expect(config.upgradesEnabled).toBe(false);
    expect(hasCheckoutConfigured(config)).toBe(false);
  });

  it('defaults paid upgrades to enabled outside explicit production config', () => {
    const config = getBillingConfig({
      WEB_PUBLIC_URL: 'http://localhost:3000',
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_BASIC_MONTHLY_PRICE_ID: 'price_basic',
    });

    expect(config.upgradesEnabled).toBe(true);
    expect(hasCheckoutConfigured(config)).toBe(true);
  });
});
