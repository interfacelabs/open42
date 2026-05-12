/**
 * Workspace credentials route — BYOK Lane E3.
 *
 * Lets the workspace owner upsert / delete / list per-tenant LLM provider
 * credentials. The route is the backend half of the Settings UI flow; the
 * web proxy at apps/web/pages/api/workspaces/[id]/credentials.ts (Lane E4)
 * calls these endpoints on the user's behalf.
 *
 * Design notes:
 *   - The workspace id is taken from the route param. `requireMembership`
 *     (mounted on the parent path in apps/api/src/index.ts) asserts the
 *     caller has a membership row on that workspace, so the handler can read
 *     `req.workspace!.id` directly. The previous `resolveOwnerWorkspaceId`
 *     path returned "some owned workspace" non-deterministically when a user
 *     owned multiple — that broke multi-workspace semantics, hence this move.
 *   - Authorization is via the membership table — never `users.currentWorkspaceId`.
 *     See apps/api/src/auth/membership.ts for the rationale (Codex ship-blocker #1).
 *   - GET intentionally never returns the secret or its length. The UI only
 *     needs to know which (provider, scope) pairs are configured.
 *   - DELETE is idempotent: 200 even when no row exists.
 *   - POST rejects the (anthropic, embed) combo because Anthropic exposes
 *     no embeddings API; the resolver returns null for that pair regardless
 *     of what we store, so accepting it would mislead the user.
 *   - Storing / deleting BYOK keys does NOT touch the tenant container env.
 *     The proxy resolves keys at request time. See
 *     apps/api/src/tenants/provision.ts for the long-form justification.
 */
import { eq } from 'drizzle-orm';
import { Router } from 'express';

import {
  deleteLlmKey as defaultDeleteLlmKey,
  upsertLlmKey as defaultUpsertLlmKey,
  type LlmProvider,
  type LlmScope,
} from '../../auth/llm-keys.js';
import { db as defaultDb, schema } from '../../db/client.js';

const VALID_PROVIDERS: readonly LlmProvider[] = ['openai', 'anthropic'] as const;
const VALID_SCOPES: readonly LlmScope[] = ['chat', 'embed'] as const;
const API_KEY_MAX = 256;
const MODEL_MAX = 100;

export interface WorkspaceCredentialsRouterDeps {
  upsertLlmKey?: typeof defaultUpsertLlmKey;
  deleteLlmKey?: typeof defaultDeleteLlmKey;
  db?: typeof defaultDb;
}

export function buildWorkspaceCredentialsRouter(
  deps: WorkspaceCredentialsRouterDeps = {},
) {
  const upsertLlmKey = deps.upsertLlmKey ?? defaultUpsertLlmKey;
  const deleteLlmKey = deps.deleteLlmKey ?? defaultDeleteLlmKey;
  const db = deps.db ?? defaultDb;

  // `mergeParams: true` so the `:id` from the parent mount
  // (`/workspaces/:id/credentials`) is visible inside this nested router.
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;

      // Explicit column list — never `select()` the row, since that would
      // pull `secretCiphertext`. The shape returned to the client must NEVER
      // include the secret bytes or anything derived from them (length, hash).
      const rows = await db
        .select({
          provider: schema.workspaceCredentials.provider,
          scope: schema.workspaceCredentials.scope,
          model: schema.workspaceCredentials.model,
          createdAt: schema.workspaceCredentials.createdAt,
        })
        .from(schema.workspaceCredentials)
        .where(eq(schema.workspaceCredentials.workspaceId, workspaceId));

      res.json({ credentials: rows });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;

      const parsed = parseProviderScope(req.body);
      if (!parsed) {
        res.status(400).json({ error: 'invalid_provider_scope' });
        return;
      }
      if (parsed.provider === 'anthropic' && parsed.scope === 'embed') {
        res.status(400).json({
          error: 'unsupported_provider_scope',
          detail: 'anthropic_has_no_embedding_api',
        });
        return;
      }

      const apiKey = parseApiKey(req.body);
      if (!apiKey) {
        res.status(400).json({ error: 'invalid_api_key' });
        return;
      }
      const model = parseModel(req.body);
      if (model === undefined) {
        // `undefined` from parseModel means "input was present but invalid".
        res.status(400).json({ error: 'invalid_model' });
        return;
      }

      await upsertLlmKey({
        workspaceId,
        provider: parsed.provider,
        scope: parsed.scope,
        apiKey,
        model,
      });

      res.json({ ok: true, source: 'tenant' });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;

      const parsed = parseProviderScope(req.body);
      if (!parsed) {
        res.status(400).json({ error: 'invalid_provider_scope' });
        return;
      }

      // Idempotent: deleteLlmKey is a no-op when no row matches, and we
      // return 200 either way so the UI doesn't have to special-case the
      // "delete a credential I just deleted" race.
      await deleteLlmKey({
        workspaceId,
        provider: parsed.provider,
        scope: parsed.scope,
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Default export wires the production helpers. Tests build the router via
 * `buildWorkspaceCredentialsRouter` with mocks instead.
 */
export const workspaceCredentialsRouter = buildWorkspaceCredentialsRouter();

function parseProviderScope(
  body: unknown,
): { provider: LlmProvider; scope: LlmScope } | null {
  if (!body || typeof body !== 'object') return null;
  const { provider, scope } = body as { provider?: unknown; scope?: unknown };
  if (typeof provider !== 'string' || typeof scope !== 'string') return null;
  if (!VALID_PROVIDERS.includes(provider as LlmProvider)) return null;
  if (!VALID_SCOPES.includes(scope as LlmScope)) return null;
  return { provider: provider as LlmProvider, scope: scope as LlmScope };
}

function parseApiKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { apiKey } = body as { apiKey?: unknown };
  if (typeof apiKey !== 'string') return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  if (trimmed.length > API_KEY_MAX) return null;
  return trimmed;
}

/**
 * Returns:
 *   - a non-empty trimmed string (≤ MODEL_MAX) when `model` is present and valid
 *   - `null` when `model` is omitted (caller wants to clear / unset the override)
 *   - `undefined` when the input was present but malformed (caller should 400)
 */
function parseModel(body: unknown): string | null | undefined {
  if (!body || typeof body !== 'object') return null;
  const obj = body as { model?: unknown };
  if (!('model' in obj)) return null;
  if (obj.model === null) return null;
  if (typeof obj.model !== 'string') return undefined;
  const trimmed = obj.model.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MODEL_MAX) return undefined;
  return trimmed;
}
