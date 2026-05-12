import type express from 'express';
import type pino from 'pino';

import { registerCloudLlmUsageRecorder } from '../../../apps/api/src/cloud-hooks.js';
import { registerTenantProvisioner } from '../../../apps/api/src/tenants/provision.js';
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
    requireRole: typeof import('../../../apps/api/src/middleware/require-role.js').requireRole;
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
