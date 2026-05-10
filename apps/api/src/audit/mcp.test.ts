import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fingerprintArgs, recordMcpCall } from './mcp.js';

const TEST_KEK = 'a'.repeat(64);
process.env.OPEN42_KEK = process.env.OPEN42_KEK ?? TEST_KEK;

describe('fingerprintArgs (HMAC determinism + secrecy)', () => {
  it('hashes identically for identical inputs (key-order independent)', () => {
    const a = fingerprintArgs({ query: 'refund policy', limit: 8 });
    const b = fingerprintArgs({ limit: 8, query: 'refund policy' });
    expect(a.equals(b)).toBe(true);
    expect(a.byteLength).toBe(32);
  });

  it('hashes differently when arguments differ', () => {
    const a = fingerprintArgs({ query: 'refund policy' });
    const b = fingerprintArgs({ query: 'enterprise refund' });
    expect(a.equals(b)).toBe(false);
  });

  it('does NOT contain plaintext substrings (it is a fingerprint, not encryption)', () => {
    const sensitive = 'CONFIDENTIAL CUSTOMER NAME';
    const hmac = fingerprintArgs({ query: sensitive });
    // Buffer.indexOf(string) finds raw byte sequences. Plaintext must not be present.
    expect(hmac.indexOf(sensitive, 0, 'utf8')).toBe(-1);
    expect(hmac.indexOf('CONFIDENTIAL', 0, 'utf8')).toBe(-1);
  });

  it('handles nested objects and arrays deterministically', () => {
    const a = fingerprintArgs({ filters: { tags: ['a', 'b'], owner: 'rico' } });
    const b = fingerprintArgs({ filters: { owner: 'rico', tags: ['a', 'b'] } });
    expect(a.equals(b)).toBe(true);
  });
});

describe('recordMcpCall (fire-and-forget semantics)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does NOT throw when the DB insert fails — audit must not break user flow', async () => {
    vi.doMock('../db/client.js', () => ({
      schema: { mcpAuditLog: {} },
      db: {
        insert: () => ({
          values: () => Promise.reject(new Error('simulated DB outage')),
        }),
      },
    }));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { recordMcpCall: recordWithBrokenDb } = await import('./mcp.js');
    await expect(
      recordWithBrokenDb({
        workspaceId: '00000000-0000-0000-0000-000000000001',
        toolName: 'query',
        requestArgs: { query: 'irrelevant' },
        status: 200,
        durationMs: 12,
      }),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mcp-audit]'),
      expect.stringContaining('simulated DB outage'),
    );

    consoleSpy.mockRestore();
    vi.doUnmock('../db/client.js');
  });

  it('generates a requestId when none provided and accepts the supplied one', async () => {
    const captured: Array<Record<string, unknown>> = [];
    vi.doMock('../db/client.js', () => ({
      schema: { mcpAuditLog: {} },
      db: {
        insert: () => ({
          values: async (row: Record<string, unknown>) => {
            captured.push(row);
          },
        }),
      },
    }));

    const { recordMcpCall: rec } = await import('./mcp.js');
    await rec({
      workspaceId: '00000000-0000-0000-0000-000000000001',
      toolName: 'query',
      requestArgs: { q: 'a' },
      status: 200,
      durationMs: 10,
    });
    await rec({
      workspaceId: '00000000-0000-0000-0000-000000000001',
      toolName: 'query',
      requestArgs: { q: 'b' },
      requestId: 'caller-supplied-id',
      status: 200,
      durationMs: 10,
    });

    expect(captured).toHaveLength(2);
    expect(typeof captured[0]!.requestId).toBe('string');
    expect((captured[0]!.requestId as string).length).toBeGreaterThan(0);
    expect(captured[1]!.requestId).toBe('caller-supplied-id');

    vi.doUnmock('../db/client.js');
  });
});

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('recordMcpCall (Postgres round-trip)', () => {
  // Lazy import — env-gated. Pattern matches sessions.db.test.ts /
  // current-workspace.db.test.ts (DATABASE_URL gate).
  let db: typeof import('../db/client.js').db;
  let schema: typeof import('../db/client.js').schema;
  let recordMcpCallReal: typeof import('./mcp.js').recordMcpCall;

  const workspaceId = '00000000-0000-0000-0000-000000000abc';
  const ownerUserId = '00000000-0000-0000-0000-000000000def';

  beforeEach(async () => {
    vi.resetModules();
    ({ db, schema } = await import('../db/client.js'));
    ({ recordMcpCall: recordMcpCallReal } = await import('./mcp.js'));

    // Clean fixture rows from previous runs.
    await db.execute(sql`DELETE FROM mcp_audit_log WHERE workspace_id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${ownerUserId}`);
    await db.execute(sql`
      INSERT INTO users (id, email)
      VALUES (${ownerUserId}, ${'audit-fixture@example.com'})
    `);
    await db.execute(sql`
      INSERT INTO workspaces (id, owner_user_id, gbrain_version)
      VALUES (${workspaceId}, ${ownerUserId}, ${'0.31.3'})
    `);
  });

  afterAll(async () => {
    if (!hasDb) return;
    const { db: cleanupDb } = await import('../db/client.js');
    await cleanupDb.execute(sql`DELETE FROM mcp_audit_log WHERE workspace_id = ${workspaceId}`);
    await cleanupDb.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
    await cleanupDb.execute(sql`DELETE FROM users WHERE id = ${ownerUserId}`);
  });

  it('persists structural metadata only — request body bytes are unrecoverable', async () => {
    const sensitive = 'CONFIDENTIAL CUSTOMER NAME';
    await recordMcpCallReal({
      workspaceId,
      callerUserId: ownerUserId,
      toolName: 'query',
      requestArgs: { query: sensitive, filters: { tag: 'urgent' } },
      status: 200,
      durationMs: 42,
      resultCount: 3,
    });

    const rows = await db
      .select()
      .from(schema.mcpAuditLog)
      .where(sql`${schema.mcpAuditLog.workspaceId} = ${workspaceId}`);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.toolName).toBe('query');
    expect(row.status).toBe(200);
    expect(row.durationMs).toBe(42);
    expect(row.resultCount).toBe(3);
    expect(row.callerUserId).toBe(ownerUserId);
    expect(Buffer.isBuffer(row.requestHmac)).toBe(true);
    expect(row.requestHmac.byteLength).toBe(32);
    // The whole point: plaintext is NOT recoverable from the audit row.
    expect(row.requestHmac.indexOf(sensitive, 0, 'utf8')).toBe(-1);
    expect(row.requestHmac.indexOf('CONFIDENTIAL', 0, 'utf8')).toBe(-1);
  });
});
