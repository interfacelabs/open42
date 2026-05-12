import type express from 'express';
import type pino from 'pino';

import { registerCloudLlmUsageRecorder } from '@open42/api/cloud-hooks';
import { requireRole as coreRequireRole } from '@open42/api/middleware/require-role';
import { registerTenantProvisioner } from '@open42/api/tenants/provision';
import { buildWorkspaceBillingRouter } from './routes/workspaces/billing.js';
import { buildStripeWebhookRouter } from './routes/webhooks/stripe.js';
import { recordLlmUsage, startBillingUsageRetryLoop } from './billing/usage.js';
import { createFlyTenant } from './tenants/provision-fly.js';

export interface CloudApiHandle {
  stop(): void | Promise<void>;
}

export function registerCloudRuntime(): void {
  registerCloudLlmUsageRecorder(recordLlmUsage);
  registerTenantProvisioner('fly', createFlyTenant);
}

export function mountCloudWebhooks(app: express.Express): void {
  app.use('/webhooks/stripe', buildStripeWebhookRouter());
}

export function mountCloudRoutes(
  app: express.Express,
  deps: {
    logger?: Pick<pino.Logger, 'error' | 'info'>;
    requireRole: typeof coreRequireRole;
  },
): CloudApiHandle {
  app.use(
    '/workspaces/:id/billing',
    deps.requireRole(['owner'], { from: 'param' }, 'forbidden_owner_only'),
    buildWorkspaceBillingRouter(),
  );
  const retryLoop = startBillingUsageRetryLoop({ logger: deps.logger });
  return {
    stop() {
      retryLoop.stop();
    },
  };
}
