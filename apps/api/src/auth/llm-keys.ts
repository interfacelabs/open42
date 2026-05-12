/**
 * BYOK key resolver — Lane E1.
 *
 * Single contract every LLM call site (egress proxy, embeddings worker, etc.)
 * uses to obtain an upstream API key. Tenant-configured BYOK keys (rows in
 * `workspace_credentials`) take precedence; otherwise we fall back to the
 * shared env-configured keys. Returns `null` when neither is available — the
 * caller decides whether to surface that as 503 'upstream_key_unconfigured'.
 *
 * The resolver never throws on the not-found case. It only throws on
 * programmer error (missing input fields). Decryption failures (envelope
 * corruption / KEK mismatch) are caught and logged; the resolver returns
 * `null` so a misconfigured tenant degrades gracefully rather than 500-ing.
 *
 * Stable contract — Lanes E2 (proxy wiring), E3 (tenant container env), and
 * E4 (settings UI) all build against this signature. Don't change return
 * shape without updating the matching follow-up lane prompts.
 */
import { and, eq } from 'drizzle-orm';
import type pino from 'pino';

import { db as defaultDb } from '../db/client.js';
import { workspaceCredentials } from '../db/schema.js';
import { decryptSecret as defaultDecryptSecret } from '../crypto/envelope.js';
import { OPEN42_ALLOW_SHARED_KEYS } from '../env.js';

export type LlmProvider = 'openai' | 'anthropic';
export type LlmScope = 'chat' | 'embed';

export interface ResolveLlmKeyInput {
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
}

export interface ResolvedLlmKey {
  apiKey: string;
  source: 'tenant' | 'shared';
  /** Tenant override if present; null/undefined for shared. */
  model?: string | null;
}

export interface ResolveLlmKeyDeps {
  db?: typeof defaultDb;
  decrypt?: typeof defaultDecryptSecret;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<pino.Logger, 'error'>;
}

/**
 * Resolve the upstream API key for a (workspace, provider, scope) triple.
 *
 * Order of precedence:
 *   1. Tenant BYOK row in `workspace_credentials` → decrypt + return as 'tenant'.
 *   2. Shared env var (OPENAI_API_KEY / ANTHROPIC_API_KEY), only when
 *      OPEN42_ALLOW_SHARED_KEYS is enabled → return as 'shared'.
 *   3. Otherwise → null. Caller maps to upstream_key_unconfigured.
 *
 * Special case: Anthropic exposes no embeddings API. `(anthropic, embed)`
 * with no tenant row returns `null` regardless of `ANTHROPIC_API_KEY` — the
 * env key is for chat only and using it for embeddings would always 404.
 */
export async function resolveLlmKey(
  input: ResolveLlmKeyInput,
  deps: ResolveLlmKeyDeps = {},
): Promise<ResolvedLlmKey | null> {
  if (!input.workspaceId) {
    throw new Error('resolveLlmKey: workspaceId is required');
  }
  if (input.provider !== 'openai' && input.provider !== 'anthropic') {
    throw new Error(`resolveLlmKey: invalid provider '${input.provider}'`);
  }
  if (input.scope !== 'chat' && input.scope !== 'embed') {
    throw new Error(`resolveLlmKey: invalid scope '${input.scope}'`);
  }

  const db = deps.db ?? defaultDb;
  const decrypt = deps.decrypt ?? defaultDecryptSecret;
  const env = deps.env ?? process.env;
  const logger = deps.logger;

  // Defense-in-depth: Anthropic exposes no embeddings API. The credentials
  // route blocks (anthropic, embed) at write time, but a stray DB row from a
  // future migration / manual edit / out-of-band path must not be served
  // either. Return null before the lookup so we never decrypt or expose it.
  if (input.provider === 'anthropic' && input.scope === 'embed') {
    return null;
  }

  // 1. Tenant BYOK lookup.
  const [row] = await db
    .select({
      secretCiphertext: workspaceCredentials.secretCiphertext,
      model: workspaceCredentials.model,
    })
    .from(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, input.workspaceId),
        eq(workspaceCredentials.provider, input.provider),
        eq(workspaceCredentials.scope, input.scope),
      ),
    )
    .limit(1);

  if (row) {
    try {
      const apiKey = decrypt(row.secretCiphertext, {
        workspaceId: input.workspaceId,
        purpose: 'workspace_credential',
      });
      return { apiKey, source: 'tenant', model: row.model };
    } catch (err) {
      // Don't crash the request — degrade to "no key available" so the
      // caller can return 503. Body content is never logged; only the
      // structural fields and the error type/message.
      logger?.error(
        {
          err: err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) },
          workspaceId: input.workspaceId,
          provider: input.provider,
          scope: input.scope,
        },
        'workspace_credential_decrypt_failed',
      );
      return null;
    }
  }

  // 2. Shared env fallback. (anthropic, embed) is already blocked above —
  //    the early-return doubles as the "no Anthropic embeddings API" guard.
  //    A future embeddings provider (e.g. Voyage) would slot in here.
  const sharedKeysAllowed =
    deps.env && 'OPEN42_ALLOW_SHARED_KEYS' in deps.env
      ? ['1', 'true', 'yes', 'on'].includes(
          String(deps.env.OPEN42_ALLOW_SHARED_KEYS ?? '').toLowerCase(),
        )
      : OPEN42_ALLOW_SHARED_KEYS;
  if (!sharedKeysAllowed) return null;

  const envName = input.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const apiKey = env[envName]?.trim();
  if (!apiKey) return null;

  return { apiKey, source: 'shared', model: null };
}

// =====================================================================
// Storage helpers — used by the future Settings route (Lane E4).
// =====================================================================

export interface UpsertLlmKeyInput {
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
  /** Plaintext key from the user. Encrypted before insert. */
  apiKey: string;
  model?: string | null;
}

export interface UpsertLlmKeyDeps {
  db?: typeof defaultDb;
  encrypt?: (plaintext: string, ctx: { workspaceId: string; purpose: 'workspace_credential' }) => Buffer;
}

/**
 * INSERT-or-UPDATE a tenant BYOK key. The unique index on
 * (workspace_id, provider, scope) backs the ON CONFLICT clause, so re-saving
 * from the UI does an UPDATE, not an INSERT.
 */
export async function upsertLlmKey(
  input: UpsertLlmKeyInput,
  deps: UpsertLlmKeyDeps = {},
): Promise<void> {
  if (!input.workspaceId) throw new Error('upsertLlmKey: workspaceId is required');
  if (!input.apiKey) throw new Error('upsertLlmKey: apiKey is required');

  const db = deps.db ?? defaultDb;
  // Lazy-load encrypt so test doubles can substitute without pulling node:crypto.
  const encrypt =
    deps.encrypt ?? ((await import('../crypto/envelope.js')).encryptSecret as UpsertLlmKeyDeps['encrypt']);
  if (!encrypt) throw new Error('upsertLlmKey: encrypt dependency missing');

  const ciphertext = encrypt(input.apiKey, {
    workspaceId: input.workspaceId,
    purpose: 'workspace_credential',
  });

  await db
    .insert(workspaceCredentials)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      scope: input.scope,
      secretCiphertext: ciphertext,
      model: input.model ?? null,
    })
    .onConflictDoUpdate({
      target: [
        workspaceCredentials.workspaceId,
        workspaceCredentials.provider,
        workspaceCredentials.scope,
      ],
      set: {
        secretCiphertext: ciphertext,
        model: input.model ?? null,
        updatedAt: new Date(),
      },
    });
}

export interface DeleteLlmKeyInput {
  workspaceId: string;
  provider: LlmProvider;
  scope: LlmScope;
}

export interface DeleteLlmKeyDeps {
  db?: typeof defaultDb;
}

export async function deleteLlmKey(
  input: DeleteLlmKeyInput,
  deps: DeleteLlmKeyDeps = {},
): Promise<void> {
  if (!input.workspaceId) throw new Error('deleteLlmKey: workspaceId is required');
  const db = deps.db ?? defaultDb;
  await db
    .delete(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, input.workspaceId),
        eq(workspaceCredentials.provider, input.provider),
        eq(workspaceCredentials.scope, input.scope),
      ),
    );
}
