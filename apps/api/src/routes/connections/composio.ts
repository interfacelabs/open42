import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';

import { getWorkspaceReadiness } from '../../auth/membership.js';
import { ComposioProfileError, resolveComposioProfileForInit } from '../../composio/profiles.js';
import {
  findConnectableComposioServiceById,
  findConnectableComposioServiceByConnectionKind,
  serviceIdForConnectionKind,
} from '../../connectors/catalog.js';
import { generateNonce, signState, verifyState } from '../../connections/state-hmac.js';
import { db, schema } from '../../db/client.js';
import { OPEN42_INGEST_HMAC_SECRET, WEB_PUBLIC_URL } from '../../env.js';

export interface ComposioRouterDeps {
  resolveProfile?: typeof resolveComposioProfileForInit;
  kick?: (workspaceId: string) => Promise<void>;
}

/**
 * Composio OAuth init/finalize routes, scoped to the workspace named in the
 * parent path (`/workspaces/:id/connections`). Membership has already been
 * asserted by `requireMembership` — handlers read `req.workspace!.id` and
 * `req.session!.userId` directly. `mergeParams: true` keeps the parent
 * `:id` visible.
 */
export function buildComposioRouter(depsIn: ComposioRouterDeps = {}) {
  const router = Router({ mergeParams: true });
  const kick = depsIn.kick ?? (async () => undefined);
  const resolveProfile = depsIn.resolveProfile ?? resolveComposioProfileForInit;

  router.post('/init', async (req, res, next) => {
    try {
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'composio_not_configured', detail: 'hmac_secret_missing' });
        return;
      }
      const connectionKind = typeof req.body?.kind === 'string' ? req.body.kind : '';
      const requestedServiceId =
        typeof req.body?.serviceId === 'string'
          ? req.body.serviceId
          : serviceIdForConnectionKind(connectionKind);
      const service =
        (connectionKind && findConnectableComposioServiceByConnectionKind(connectionKind)) ||
        (requestedServiceId && findConnectableComposioServiceById(requestedServiceId));
      if (!service || !requestedServiceId || requestedServiceId !== service.serviceId) {
        res.status(400).json({ error: 'unsupported_connection_kind' });
        return;
      }
      if (service.serviceId !== 'notion') {
        res.status(400).json({ error: 'unsupported_connection_kind' });
        return;
      }
      const session = req.session!;
      const workspaceId = req.workspace!.id;
      const authProfileId =
        typeof req.body?.authProfileId === 'string' ? req.body.authProfileId : null;
      const profile = await resolveProfile({
        workspaceId,
        serviceId: service.serviceId,
        authProfileId,
      });
      // Reject the request if the tenant runtime isn't ready yet — otherwise
      // we'd hand back an OAuth redirect that, after callback, tries to ingest
      // against a gbrain that doesn't exist yet. 425 Too Early lets the client
      // retry once the runtime flips ready.
      const readiness = await getWorkspaceReadiness(workspaceId);
      if (!readiness || readiness.status !== 'ready' || !readiness.gbrainReady) {
        res.status(425).json({
          error: 'workspace_not_ready',
          status: readiness?.status ?? 'unknown',
        });
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
        serviceId: service.serviceId,
        connectorAuthProfileId: profile.profileId,
      });
      const redirectUri = `${WEB_PUBLIC_URL}/connections/composio/callback?state=${encodeURIComponent(
        state,
      )}`;

      const initRes = await profile.client.initiateConnection({
        user_id: workspaceId,
        app: service.serviceId,
        auth_config_id: profile.authConfigId,
        redirect_uri: redirectUri,
      });

      await db.insert(schema.connectionInitStates).values({
        state,
        workspaceId,
        userId: session.userId,
        kind: 'notion-composio',
        serviceId: service.serviceId,
        connectorAuthProfileId: profile.profileId,
        composioPendingId: initRes.pending_connected_account_id,
        expiresAt: new Date(expiresAt),
      });

      res.json({ redirect_url: initRes.redirect_url });
    } catch (err) {
      if (err instanceof ComposioProfileError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      next(err);
    }
  });

  router.post('/composio/finalize', async (req, res, next) => {
    try {
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'composio_not_configured' });
        return;
      }

      const session = req.session!;

      const state = typeof req.body?.state === 'string' ? req.body.state : '';
      const connectedAccountId =
        typeof req.body?.connectedAccountId === 'string' ? req.body.connectedAccountId : '';
      if (!state || !connectedAccountId) {
        res.status(400).json({ error: 'missing_params' });
        return;
      }

      const payload = verifyState(OPEN42_INGEST_HMAC_SECRET, state);
      if (!payload) {
        res.status(400).json({ error: 'state_invalid' });
        return;
      }
      if (payload.userId !== session.userId) {
        res.status(403).json({ error: 'state_user_mismatch' });
        return;
      }
      // The OAuth state payload is signed against a specific workspaceId. The
      // path-supplied workspaceId (already asserted by requireMembership) must
      // match — otherwise an attacker with valid membership in workspace A
      // could replay an HMAC for workspace B.
      if (payload.workspaceId !== req.workspace!.id) {
        res.status(400).json({ error: 'state_metadata_mismatch' });
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
        // Already consumed or never existed. Treat as already-finalized
        // when a connection exists for this workspace; otherwise expired.
        const existing = await hasActiveNotionConnection(payload.workspaceId);
        res
          .status(existing ? 409 : 410)
          .json({ error: existing ? 'already_connected' : 'state_expired' });
        return;
      }
      if (
        initState.workspaceId !== payload.workspaceId ||
        initState.userId !== payload.userId ||
        initState.kind !== 'notion-composio' ||
        (payload.serviceId && initState.serviceId && payload.serviceId !== initState.serviceId) ||
        (payload.connectorAuthProfileId ?? null) !== (initState.connectorAuthProfileId ?? null) ||
        initState.expiresAt.getTime() < Date.now()
      ) {
        res.status(400).json({ error: 'state_metadata_mismatch' });
        return;
      }
      if (initState.composioPendingId && initState.composioPendingId !== connectedAccountId) {
        res.status(400).json({ error: 'account_id_mismatch' });
        return;
      }

      const serviceId = initState.serviceId ?? payload.serviceId ?? 'notion';
      const profile = await resolveProfile({
        workspaceId: payload.workspaceId,
        serviceId,
        authProfileId: initState.connectorAuthProfileId,
      });
      const account = await profile.client.getConnection(connectedAccountId);
      if (account.status !== 'ACTIVE') {
        res.status(400).json({ error: 'account_not_active', status: account.status });
        return;
      }

      try {
        await db.insert(schema.connections).values({
          workspaceId: payload.workspaceId,
          kind: 'notion-composio',
          serviceId: profile.service.serviceId,
          connectorAuthProfileId: profile.profileId,
          status: 'pending_import',
          displayName: 'Notion · Live',
          composioConnectedAccountId: connectedAccountId,
          cursor: {},
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ error: 'already_connected' });
          return;
        }
        throw err;
      }

      void kick(payload.workspaceId).catch(() => undefined);
      res.json({ ok: true, redirectTo: '/' });
    } catch (err) {
      if (err instanceof ComposioProfileError) {
        res.status(err.status).json({ error: err.code });
        return;
      }
      next(err);
    }
  });

  return router;
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
