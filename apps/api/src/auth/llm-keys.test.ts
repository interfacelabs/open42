import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../env.js';
import {
  deleteLlmKey,
  resolveLlmKey,
  upsertLlmKey,
  type ResolveLlmKeyDeps,
} from './llm-keys.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

/**
 * Build a fake `db` that returns the supplied row from a `select-from-where-limit`
 * chain. Mirrors the shape Drizzle's `db.select(...).from(...).where(...).limit(1)`
 * resolves to so tests don't have to spin up Postgres for the fast path checks.
 */
function fakeSelectingDb(row: { secretCiphertext: Buffer; model: string | null } | null) {
  const limit = vi.fn(async () => (row ? [row] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as ResolveLlmKeyDeps['db'];
}

describe('resolveLlmKey', () => {
  it('returns the decrypted tenant key when a workspace_credentials row exists', async () => {
    const ciphertext = Buffer.from('ENVELOPE_BYTES');
    const decrypt = vi.fn(() => 'sk-tenant-decrypted');

    const result = await resolveLlmKey(
      {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        provider: 'openai',
        scope: 'chat',
      },
      {
        db: fakeSelectingDb({ secretCiphertext: ciphertext, model: 'gpt-5-1' }),
        decrypt: decrypt as unknown as ResolveLlmKeyDeps['decrypt'],
        env: { OPENAI_API_KEY: 'sk-shared-should-not-be-used' },
      },
    );

    expect(result).toEqual({ apiKey: 'sk-tenant-decrypted', source: 'tenant', model: 'gpt-5-1' });
    expect(decrypt).toHaveBeenCalledWith(ciphertext, {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      purpose: 'workspace_credential',
    });
  });

  it('falls back to the shared env key when no tenant row exists', async () => {
    const result = await resolveLlmKey(
      {
        workspaceId: '22222222-2222-4222-8222-222222222222',
        provider: 'anthropic',
        scope: 'chat',
      },
      {
        db: fakeSelectingDb(null),
        env: { ANTHROPIC_API_KEY: '  sk-shared-trim-me  ' },
      },
    );

    expect(result).toEqual({ apiKey: 'sk-shared-trim-me', source: 'shared', model: null });
  });

  it('returns null when neither tenant row nor env var is set', async () => {
    const result = await resolveLlmKey(
      {
        workspaceId: '33333333-3333-4333-8333-333333333333',
        provider: 'openai',
        scope: 'embed',
      },
      {
        db: fakeSelectingDb(null),
        env: {},
      },
    );

    expect(result).toBeNull();
  });

  it('returns null for (anthropic, embed) regardless of env (no Anthropic embeddings API)', async () => {
    const result = await resolveLlmKey(
      {
        workspaceId: '44444444-4444-4444-8444-444444444444',
        provider: 'anthropic',
        scope: 'embed',
      },
      {
        db: fakeSelectingDb(null),
        env: { ANTHROPIC_API_KEY: 'sk-not-usable-for-embeddings' },
      },
    );

    expect(result).toBeNull();
  });

  it('returns null for (anthropic, embed) even when a stray DB row exists (defense-in-depth)', async () => {
    // The credentials route blocks this combo at write time, but the resolver
    // must also refuse to serve such a row in case it landed via migration,
    // manual psql, or a future code path that bypasses the route.
    const decrypt = vi.fn(() => 'should-never-be-returned');
    const db = fakeSelectingDb({
      secretCiphertext: Buffer.from('would-decrypt-fine'),
      model: null,
    });

    const result = await resolveLlmKey(
      {
        workspaceId: '4a4a4a4a-4444-4444-8444-444444444444',
        provider: 'anthropic',
        scope: 'embed',
      },
      { db, decrypt, env: { ANTHROPIC_API_KEY: 'sk-not-usable-for-embeddings' } },
    );

    expect(result).toBeNull();
    // Decrypt MUST NOT have been called — the early-return precedes the lookup.
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns null and logs (no body content) when decryption throws', async () => {
    const decrypt = vi.fn(() => {
      throw new Error('envelope authentication failed: bad tag');
    });
    const logger = { error: vi.fn() };

    const result = await resolveLlmKey(
      {
        workspaceId: '55555555-5555-4555-8555-555555555555',
        provider: 'openai',
        scope: 'chat',
      },
      {
        db: fakeSelectingDb({ secretCiphertext: Buffer.from('corrupt'), model: null }),
        decrypt: decrypt as unknown as ResolveLlmKeyDeps['decrypt'],
        env: { OPENAI_API_KEY: 'sk-shared' },
        logger,
      },
    );

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logArg, msg] = logger.error.mock.calls[0]!;
    expect(msg).toBe('workspace_credential_decrypt_failed');
    // Structural fields only; never any plaintext or ciphertext bytes.
    expect(logArg).toMatchObject({
      workspaceId: '55555555-5555-4555-8555-555555555555',
      provider: 'openai',
      scope: 'chat',
    });
    expect(JSON.stringify(logArg)).not.toContain('corrupt');
  });

  it('throws on programmer error (missing workspaceId)', async () => {
    await expect(
      resolveLlmKey({
        workspaceId: '',
        provider: 'openai',
        scope: 'chat',
      }),
    ).rejects.toThrow(/workspaceId is required/);
  });
});

describeDb('resolveLlmKey + upsertLlmKey + deleteLlmKey (round-trip)', () => {
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    dbMod = await import('../db/client.js');
  });

  beforeEach(() => {
    process.env.OPEN42_KEK = 'c'.repeat(64);
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.workspaceCredentials)
        .where(eq(dbMod.schema.workspaceCredentials.workspaceId, workspaceId));
      await dbMod.db
        .delete(dbMod.schema.memberships)
        .where(eq(dbMod.schema.memberships.workspaceId, workspaceId));
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  afterAll(() => {
    delete process.env.OPEN42_KEK;
  });

  async function seedWorkspace(): Promise<string> {
    const tag = `${Date.now()}-${Math.random()}`;
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `llm-keys-${tag}@open42.test` })
      .returning({ id: dbMod.schema.users.id });
    if (!user) throw new Error('user_insert_failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId: user.id,
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: 'ready',
      })
      .returning({ id: dbMod.schema.workspaces.id });
    if (!workspace) throw new Error('workspace_insert_failed');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  it('round-trips an OpenAI chat key through encrypt → DB → resolve', async () => {
    const workspaceId = await seedWorkspace();

    await upsertLlmKey({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-real-tenant-key-1',
      model: 'gpt-5-mini',
    });

    const resolved = await resolveLlmKey({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-real-tenant-key-1',
      source: 'tenant',
      model: 'gpt-5-mini',
    });
  });

  it('upsert is idempotent on (workspace, provider, scope) — second save UPDATEs rather than INSERTs', async () => {
    const workspaceId = await seedWorkspace();

    await upsertLlmKey({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-v1',
      model: null,
    });
    await upsertLlmKey({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
      apiKey: 'sk-v2',
      model: 'gpt-5-1',
    });

    const rows = await dbMod.db
      .select()
      .from(dbMod.schema.workspaceCredentials)
      .where(eq(dbMod.schema.workspaceCredentials.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);

    const resolved = await resolveLlmKey({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
    });
    expect(resolved).toMatchObject({ apiKey: 'sk-v2', source: 'tenant', model: 'gpt-5-1' });
  });

  it('deleteLlmKey removes the row and resolveLlmKey falls back to env afterwards', async () => {
    const workspaceId = await seedWorkspace();
    const prevEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-shared-fallback';
    try {
      await upsertLlmKey({
        workspaceId,
        provider: 'openai',
        scope: 'chat',
        apiKey: 'sk-tenant-tobedeleted',
      });
      await deleteLlmKey({ workspaceId, provider: 'openai', scope: 'chat' });

      const resolved = await resolveLlmKey({
        workspaceId,
        provider: 'openai',
        scope: 'chat',
      });
      expect(resolved).toEqual({
        apiKey: 'sk-shared-fallback',
        source: 'shared',
        model: null,
      });
    } finally {
      if (prevEnv === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevEnv;
    }
  });
});
