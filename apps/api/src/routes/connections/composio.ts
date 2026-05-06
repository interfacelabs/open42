import { Router, type Request } from 'express';
import { and, eq, sql } from 'drizzle-orm';

import { validateSession } from '../../auth/sessions.js';
import type { ComposioClient } from '../../composio/client.js';
import { createComposioClient } from '../../composio/client.js';
import { generateNonce, signState, verifyState } from '../../connections/state-hmac.js';
import { db, schema } from '../../db/client.js';
import {
  API_PUBLIC_URL,
  COMPOSIO_API_KEY,
  COMPOSIO_BASE_URL,
  OPEN42_INGEST_HMAC_SECRET,
  WEB_PUBLIC_URL,
} from '../../env.js';

export interface ComposioRouterDeps {
  composio?: ComposioClient;
  kick?: (workspaceId: string) => Promise<void>;
}

export function buildComposioRouter(depsIn: ComposioRouterDeps = {}) {
  const router = Router();
  const kick = depsIn.kick ?? (async () => undefined);
  let cachedComposio: Promise<ComposioClient> | null = null;

  const getComposio = (): Promise<ComposioClient> | null => {
    if (depsIn.composio) return Promise.resolve(depsIn.composio);
    if (!COMPOSIO_API_KEY) return null;
    cachedComposio ??= createComposioClient({
      apiKey: COMPOSIO_API_KEY,
      baseUrl: COMPOSIO_BASE_URL,
    });
    return cachedComposio;
  };

  router.post('/init', async (req, res, next) => {
    try {
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'composio_not_configured', detail: 'hmac_secret_missing' });
        return;
      }
      const composio = getComposio();
      if (!composio) {
        res.status(503).json({ error: 'composio_not_configured' });
        return;
      }
      if (req.body?.kind !== 'notion-composio') {
        res.status(400).json({ error: 'unsupported_connection_kind' });
        return;
      }
      const session = await sessionFromRequest(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const workspaceId = await ownerWorkspaceId(session.userId);
      if (!workspaceId) {
        res.status(403).json({ error: 'no_workspace' });
        return;
      }
      // TODO(P1.5): this pre-check is best-effort UX only; the partial unique index
      // remains the source of truth because initiateConnection is outside this txn.
      if (await hasActiveNotionConnection(workspaceId)) {
        res.status(409).json({ error: 'notion_connection_exists' });
        return;
      }

      const expiresAt = Date.now() + 10 * 60 * 1000;
      const state = signState(OPEN42_INGEST_HMAC_SECRET, {
        workspaceId,
        userId: session.userId,
        nonce: generateNonce(),
        expiresAt,
      });
      const redirectUri = `${API_PUBLIC_URL}/connections/composio/callback?state=${encodeURIComponent(
        state,
      )}`;

      const initRes = await (
        await composio
      ).initiateConnection({
        user_id: workspaceId,
        app: 'notion',
        redirect_uri: redirectUri,
      });

      await db.insert(schema.connectionInitStates).values({
        state,
        workspaceId,
        userId: session.userId,
        kind: 'notion-composio',
        composioPendingId: initRes.pending_connected_account_id,
        expiresAt: new Date(expiresAt),
      });

      res.json({ redirect_url: initRes.redirect_url });
    } catch (err) {
      next(err);
    }
  });

  router.get('/composio/callback', async (req, res, next) => {
    try {
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).send('composio_not_configured');
        return;
      }
      const composio = getComposio();
      if (!composio) {
        res.status(503).send('composio_not_configured');
        return;
      }

      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const connectedAccountId =
        typeof req.query.connected_account_id === 'string' ? req.query.connected_account_id : '';
      if (!state || !connectedAccountId) {
        res.status(400).send('missing query params');
        return;
      }

      const payload = verifyState(OPEN42_INGEST_HMAC_SECRET, state);
      if (!payload) {
        res.status(400).send('invalid state');
        return;
      }

      const initState = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.connectionInitStates)
          .where(eq(schema.connectionInitStates.state, state))
          .limit(1)
          .for('update');
        if (!row) return null;
        await tx
          .delete(schema.connectionInitStates)
          .where(eq(schema.connectionInitStates.state, state));
        return row;
      });
      if (!initState) {
        res.status(400).send('state not found or already used');
        return;
      }
      if (
        initState.workspaceId !== payload.workspaceId ||
        initState.userId !== payload.userId ||
        initState.kind !== 'notion-composio' ||
        initState.expiresAt.getTime() < Date.now()
      ) {
        res.status(400).send('state metadata mismatch');
        return;
      }
      if (initState.composioPendingId && initState.composioPendingId !== connectedAccountId) {
        res.status(400).send('connected_account_id mismatch');
        return;
      }

      const account = await (await composio).getConnection(connectedAccountId);
      if (account.status !== 'ACTIVE') {
        res.status(400).send('account not active');
        return;
      }
      if (account.user_id !== payload.workspaceId) {
        res.status(400).send('user_id mismatch');
        return;
      }

      try {
        await db.insert(schema.connections).values({
          workspaceId: payload.workspaceId,
          kind: 'notion-composio',
          status: 'pending_import',
          displayName: 'Notion · Live',
          composioConnectedAccountId: connectedAccountId,
          cursor: {},
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).send('notion_connection_exists');
          return;
        }
        throw err;
      }

      void kick(payload.workspaceId).catch(() => undefined);
      res.redirect(302, `${WEB_PUBLIC_URL}/settings/connections?connected=notion`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

async function ownerWorkspaceId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user?.currentWorkspaceId) return null;
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.workspaceId, user.currentWorkspaceId),
      ),
    )
    .limit(1);
  if (!membership || membership.role !== 'owner') return null;
  return user.currentWorkspaceId;
}

async function hasActiveNotionConnection(workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.connections.id })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.workspaceId, workspaceId),
        sql`${schema.connections.kind}::text LIKE 'notion-%'`,
        sql`${schema.connections.status} <> 'disconnected'`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}
