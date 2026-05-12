import Stripe from 'stripe';

import { getBillingConfig } from './config.js';

// Keep this tied to the installed Stripe SDK's declared latest version so a
// package upgrade fails typecheck until we deliberately review the API change.
export const STRIPE_API_VERSION: typeof Stripe.API_VERSION = '2026-04-22.dahlia';

let cached: { key: string; client: Stripe } | null = null;

export function getStripeClient(env: NodeJS.ProcessEnv = process.env): Stripe | null {
  const config = getBillingConfig(env);
  if (!config.stripeSecretKey) return null;
  if (cached?.key === config.stripeSecretKey) return cached.client;

  const client = new Stripe(config.stripeSecretKey, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: 'Open42',
      version: '0.1.0',
    },
  });
  cached = { key: config.stripeSecretKey, client };
  return client;
}
