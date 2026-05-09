import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

import express, { Router, type Request, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import pino from 'pino';

import { db, schema } from '../../db/client.js';
import { sanitizeErrorForLog } from '../../middleware/error-sanitize.js';

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const RAW_BODY_LIMIT = '1mb';

const logger = pino({ name: 'webhooks/composio', level: process.env.LOG_LEVEL ?? 'info' });

export interface ComposioWebhookDeps {
  secret: string;
  kick: (workspaceId: string) => Promise<void>;
  now?: () => number;
}

export function buildComposioWebhookRouter(deps: ComposioWebhookDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: RAW_BODY_LIMIT }),
    async (req: Request, res: Response) => {
      if (!deps.secret) {
        // Misconfigured server: don't 5xx and trigger Composio retries forever.
        logger.error('webhook_secret_missing');
        res.status(503).json({ error: 'webhook_not_configured' });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const webhookId = headerString(req, 'webhook-id');
      const webhookTimestamp = headerString(req, 'webhook-timestamp');
      const webhookSignature = headerString(req, 'webhook-signature');

      if (!webhookId || !webhookTimestamp || !webhookSignature || rawBody.length === 0) {
        res.status(400).json({ error: 'missing_webhook_headers' });
        return;
      }

      const tsSeconds = Number(webhookTimestamp);
      if (!Number.isFinite(tsSeconds)) {
        res.status(400).json({ error: 'webhook_timestamp_invalid' });
        return;
      }
      if (Math.abs(now() / 1000 - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
        res.status(400).json({ error: 'webhook_timestamp_out_of_tolerance' });
        return;
      }

      const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody.toString('utf8')}`;
      const expected = createHmac('sha256', deps.secret).update(signedPayload).digest('base64');
      if (!matchAnyV1Signature(webhookSignature, expected)) {
        res.status(401).json({ error: 'webhook_signature_invalid' });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'webhook_payload_not_json' });
        return;
      }

      // Always 2xx past this point so Composio doesn't retry-storm a logic bug.
      res.status(200).json({ ok: true });

      void handlePayload(payload, deps.kick).catch((err) => {
        logger.error({ err: sanitizeErrorForLog(err) }, 'webhook_handler_failed');
      });
    },
  );

  return router;
}

async function handlePayload(
  payload: Record<string, unknown>,
  kick: (workspaceId: string) => Promise<void>,
): Promise<void> {
  const connectedAccountId = extractConnectedAccountId(payload);
  if (!connectedAccountId) {
    logger.warn({ payload: redact(payload) }, 'webhook_no_connected_account_id');
    return;
  }

  const [conn] = await db
    .select({ workspaceId: schema.connections.workspaceId, status: schema.connections.status })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.composioConnectedAccountId, connectedAccountId),
        sql`${schema.connections.status} <> 'disconnected'`,
      ),
    )
    .limit(1);

  if (!conn) {
    logger.warn({ connectedAccountId }, 'webhook_connection_unknown');
    return;
  }

  await kick(conn.workspaceId);
  logger.info({ connectedAccountId, workspaceId: conn.workspaceId }, 'webhook_kicked');
}

// Composio webhook payloads come in three versions; pick the connected
// account id from whichever shape we recognize.
function extractConnectedAccountId(payload: Record<string, unknown>): string | null {
  const direct = stringAt(payload, ['connected_account_id']);
  if (direct) return direct;

  // V3 normalized
  const v3 = stringAt(payload, ['metadata', 'connectedAccount', 'id']);
  if (v3) return v3;

  // V2 raw
  const v2Snake = stringAt(payload, ['data', 'connected_account', 'id']);
  if (v2Snake) return v2Snake;
  const v2Camel = stringAt(payload, ['data', 'connectedAccount', 'id']);
  if (v2Camel) return v2Camel;

  // V1 legacy uses connection_id
  const v1 = stringAt(payload, ['connection_id']);
  if (v1) return v1;

  return null;
}

function stringAt(value: unknown, path: string[]): string | null {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

function matchAnyV1Signature(header: string, expected: string): boolean {
  const expectedBuf = Buffer.from(expected, 'base64');
  for (const part of header.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    const provided = Buffer.from(value, 'base64');
    if (provided.length !== expectedBuf.length) continue;
    if (cryptoTimingSafeEqual(provided, expectedBuf)) return true;
  }
  return false;
}

function headerString(req: Request, name: string): string {
  const raw = req.header(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    out[key] = key === 'payload' || key === 'data' ? '[redacted]' : payload[key];
  }
  return out;
}
