import express, { Router } from 'express';
import pino from 'pino';
import type Stripe from 'stripe';

import { db as defaultDb } from '@open42/api/db/client';
import { sanitizeErrorForLog } from '@open42/api/middleware/error-sanitize';
import { getStripeClient } from '../../billing/stripe-client.js';
import { syncCheckoutSession, syncSubscription } from '../../billing/service.js';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from '../../billing/webhook-events.js';

const logger = pino({ name: 'routes/webhooks/stripe', level: process.env.LOG_LEVEL ?? 'info' });

export interface StripeWebhookRouterDeps {
  stripe?: Stripe | null;
  webhookSecret?: string;
  db?: typeof defaultDb;
}

export function buildStripeWebhookRouter(deps: StripeWebhookRouterDeps = {}) {
  const router = Router();
  const stripe = deps.stripe === undefined ? getStripeClient() : deps.stripe;
  const webhookSecret = deps.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';

  router.post('/', express.raw({ type: 'application/json' }), async (req, res, next) => {
    try {
      if (!stripe || !webhookSecret) {
        res.status(503).json({ error: 'stripe_not_configured' });
        return;
      }

      const signature = req.header('stripe-signature');
      if (!signature) {
        res.status(400).json({ error: 'stripe_signature_required' });
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        logger.error({ err: sanitizeErrorForLog(err) }, 'stripe_webhook_signature_failed');
        res.status(400).json({ error: 'stripe_signature_invalid' });
        return;
      }

      const eventDeps = { db: deps.db };
      const claim = await claimStripeWebhookEvent(event, eventDeps);
      if (claim.status === 'duplicate') {
        res.json({ received: true, duplicate: true });
        return;
      }
      if (claim.status === 'in_progress') {
        res.status(409).json({ error: 'stripe_webhook_processing' });
        return;
      }

      const eventType = event.type as string;
      try {
        switch (eventType) {
          case 'checkout.session.completed':
            await syncCheckoutSession(event.data.object as Stripe.Checkout.Session, { stripe });
            break;
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
          case 'customer.subscription.paused':
          case 'customer.subscription.resumed':
            await syncSubscription(event.data.object as Stripe.Subscription, { stripe });
            break;
          case 'invoice.paid':
          case 'invoice.payment_failed':
            await syncInvoiceSubscription(event.data.object as Stripe.Invoice, stripe);
            break;
          case 'v1.billing.meter.error_report_triggered':
          case 'v1.billing.meter.no_meter_found':
            logger.error({ event_id: event.id, type: eventType }, 'stripe_meter_event_error');
            break;
          default:
            break;
        }
        await markStripeWebhookEventProcessed(event.id, eventDeps);
      } catch (err) {
        await markStripeWebhookEventFailed(event.id, err, eventDeps);
        throw err;
      }

      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function syncInvoiceSubscription(invoice: Stripe.Invoice, stripe: Stripe): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription, { stripe });
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null };
  };
  const value = raw.subscription ?? raw.parent?.subscription_details?.subscription;
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}
