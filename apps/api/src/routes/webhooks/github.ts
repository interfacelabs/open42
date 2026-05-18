import { createHmac, timingSafeEqual } from 'node:crypto';

import express, { Router, type Request, type Response } from 'express';
import pino from 'pino';

import { loadGitHubWebhookSecretForWorkspace } from '../../github/app-config.js';
import { sanitizeErrorForLog } from '../../middleware/error-sanitize.js';
import {
  markGitHubInstallationAuthRequired,
  markGitHubReposBehind,
} from '../connections/github.js';

const logger = pino({ name: 'webhooks/github', level: process.env.LOG_LEVEL ?? 'info' });
const RAW_BODY_LIMIT = '2mb';

export interface GitHubWebhookDeps {
  secret?: string;
  kick: (workspaceId: string) => Promise<void>;
}

export function buildGitHubWebhookRouter(deps: GitHubWebhookDeps): Router {
  const router = Router();

  router.post(
    '/:workspaceId?',
    express.raw({ type: 'application/json', limit: RAW_BODY_LIMIT }),
    async (req: Request, res: Response) => {
      const workspaceId = normalizeWorkspaceId(req.params.workspaceId);
      if (req.params.workspaceId && !workspaceId) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const secret = workspaceId
        ? await loadGitHubWebhookSecretForWorkspace(workspaceId)
        : deps.secret || (await loadGitHubWebhookSecretForWorkspace(null));
      if (!secret) {
        res.status(503).json({ error: 'github_webhook_not_configured' });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      if (!verifySignature(rawBody, req.header('x-hub-signature-256') ?? '', secret)) {
        res.status(401).json({ error: 'github_signature_invalid' });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'github_payload_not_json' });
        return;
      }

      res.status(200).json({ ok: true });

      const event = req.header('x-github-event') ?? '';
      void handlePayload(event, payload, deps.kick).catch((err) => {
        logger.error({ err: sanitizeErrorForLog(err), event }, 'github_webhook_handler_failed');
      });
    },
  );

  return router;
}

async function handlePayload(
  event: string,
  payload: Record<string, unknown>,
  kick: (workspaceId: string) => Promise<void>,
): Promise<void> {
  if (event === 'push') {
    const repoId = numberAt(payload, ['repository', 'id']);
    const ref = stringAt(payload, ['ref']);
    const branch = ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
    const after = stringAt(payload, ['after']);
    if (!repoId || !branch) return;
    const marked = await markGitHubReposBehind({
      repoId: String(repoId),
      branch,
      headSha: after,
      kick,
    });
    logger.info({ repoId, branch, marked }, 'github_webhook_push_marked');
    return;
  }

  if (event === 'installation') {
    const action = stringAt(payload, ['action']);
    if (action !== 'deleted' && action !== 'suspend') return;
    const installationId = numberAt(payload, ['installation', 'id']);
    if (!installationId) return;
    await markGitHubInstallationAuthRequired(String(installationId));
  }
}

function verifySignature(rawBody: Buffer, header: string, secret: string): boolean {
  if (!header.startsWith('sha256=')) return false;
  const provided = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function stringAt(value: unknown, path: string[]): string | null {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

function numberAt(value: unknown, path: string[]): number | null {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : null;
}

function normalizeWorkspaceId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}
