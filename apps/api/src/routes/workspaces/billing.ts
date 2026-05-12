import { Router } from 'express';

import {
  BillingError,
  createCheckoutSession,
  createPortalSession,
  getWorkspaceBilling,
  mapBillingErrorStatus,
} from '../../billing/service.js';
import { parseBillingMode } from '../../billing/config.js';

export function buildWorkspaceBillingRouter() {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      res.json(await getWorkspaceBilling(workspaceId));
    } catch (err) {
      handleBillingError(err, res, next);
    }
  });

  router.post('/checkout', async (req, res, next) => {
    try {
      const rawBillingMode = req.body?.billingMode;
      const billingMode =
        rawBillingMode === undefined ? 'platform' : parseBillingMode(rawBillingMode);
      if (!billingMode) {
        res.status(400).json({ error: 'invalid_billing_mode' });
        return;
      }
      const session = await createCheckoutSession({
        workspaceId: req.workspace!.id,
        userId: req.session!.userId,
        billingMode,
      });
      res.json(session);
    } catch (err) {
      handleBillingError(err, res, next);
    }
  });

  router.post('/portal', async (req, res, next) => {
    try {
      const session = await createPortalSession(req.workspace!.id);
      res.json(session);
    } catch (err) {
      handleBillingError(err, res, next);
    }
  });

  return router;
}

function handleBillingError(
  err: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: (err: unknown) => void,
) {
  if (err instanceof BillingError) {
    res.status(mapBillingErrorStatus(err)).json({ error: err.code });
    return;
  }
  next(err);
}
