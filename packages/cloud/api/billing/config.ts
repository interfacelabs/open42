import { WEB_PUBLIC_URL } from '@open42/api/env';

export type BillingMode = 'platform' | 'byok';

export interface BillingConfig {
  stripeSecretKey: string;
  webPublicUrl: string;
  basicMonthlyPriceId: string;
  platformRequestMeteredPriceId: string;
  platformRequestMeterEventName: string;
  basicIncludedRequests: number;
  upgradesEnabled: boolean;
}

let cachedProcessConfig: BillingConfig | null = null;

export function getBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  if (env === process.env) {
    cachedProcessConfig ??= readBillingConfig(env);
    return cachedProcessConfig;
  }
  return readBillingConfig(env);
}

function readBillingConfig(env: NodeJS.ProcessEnv): BillingConfig {
  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || '',
    webPublicUrl: (env.WEB_PUBLIC_URL ?? WEB_PUBLIC_URL).replace(/\/+$/, ''),
    basicMonthlyPriceId: env.STRIPE_BASIC_MONTHLY_PRICE_ID?.trim() || '',
    platformRequestMeteredPriceId: env.STRIPE_PLATFORM_REQUEST_METERED_PRICE_ID?.trim() || '',
    platformRequestMeterEventName: env.STRIPE_PLATFORM_REQUEST_METER_EVENT_NAME?.trim() || '',
    basicIncludedRequests: positiveInt(env.OPEN42_BASIC_INCLUDED_REQUESTS, 0),
    upgradesEnabled: boolEnv(env.OPEN42_BILLING_UPGRADES_ENABLED, true),
  };
}

export function resetBillingConfigCacheForTests(): void {
  cachedProcessConfig = null;
}

export function parseBillingMode(value: unknown): BillingMode | null {
  if (value === 'platform' || value === 'byok') return value;
  return null;
}

export function billingModeLabel(mode: BillingMode): string {
  return mode === 'byok' ? 'BYOK' : 'Open42 keys';
}

export function hasStripeSecret(config: BillingConfig): boolean {
  return Boolean(config.stripeSecretKey);
}

export function hasBasePrice(config: BillingConfig): boolean {
  return hasStripeSecret(config) && Boolean(config.basicMonthlyPriceId);
}

export function hasCheckoutConfigured(config: BillingConfig): boolean {
  return config.upgradesEnabled && hasBasePrice(config);
}

export function hasMeteredPrice(config: BillingConfig): boolean {
  return hasStripeSecret(config) && Boolean(config.platformRequestMeteredPriceId);
}

export function hasMeterEvent(config: BillingConfig): boolean {
  return hasStripeSecret(config) && Boolean(config.platformRequestMeterEventName);
}

export function hasOverageMeter(config: BillingConfig): boolean {
  return hasMeteredPrice(config) && hasMeterEvent(config);
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}
