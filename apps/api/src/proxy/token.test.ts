import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import '../env.js';
import { readKek } from '../crypto/envelope.js';
import { generateProxyToken, verifyProxyToken } from './token.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describe('proxy token helpers', () => {
  beforeEach(() => {
    process.env.OPEN42_KEK = 'a'.repeat(64);
  });

  it('generates the expected tenant token shape', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const { token, hash } = generateProxyToken(workspaceId);

    expect(token).toMatch(
      /^tnt_11111111-1111-4111-8111-111111111111_[0-9a-f]{32}$/,
    );
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash).toHaveLength(32);
  });

  it('stores a deterministic HMAC-SHA256 of the token', () => {
    const { token, hash } = generateProxyToken('22222222-2222-4222-8222-222222222222');
    const expected = createHmac('sha256', readKek()).update(token, 'utf8').digest();

    expect(hash.equals(expected)).toBe(true);
  });
});

describeDb('verifyProxyToken', () => {
  let dbMod: typeof import('../db/client.js');
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    dbMod = await import('../db/client.js');
  });

  beforeEach(() => {
    process.env.OPEN42_KEK = 'b'.repeat(64);
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
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

  it('accepts a matching token for an active workspace', async () => {
    const workspace = await seedWorkspace(null);
    const { token, hash } = generateProxyToken(workspace.id);
    await dbMod.db
      .update(dbMod.schema.workspaces)
      .set({ proxyTokenHash: hash })
      .where(eq(dbMod.schema.workspaces.id, workspace.id));

    await expect(verifyProxyToken(token)).resolves.toEqual({ workspaceId: workspace.id });
  });

  it('rejects a token when the stored HMAC does not match', async () => {
    const workspace = await seedWorkspace(Buffer.alloc(32, 1));
    const { token } = generateProxyToken(workspace.id);

    await expect(verifyProxyToken(token)).resolves.toBeNull();
  });

  it('rejects a token for a deleted workspace', async () => {
    const workspace = await seedWorkspace(null, new Date('2026-05-09T00:00:00Z'));
    const { token, hash } = generateProxyToken(workspace.id);
    await dbMod.db
      .update(dbMod.schema.workspaces)
      .set({ proxyTokenHash: hash })
      .where(eq(dbMod.schema.workspaces.id, workspace.id));

    await expect(verifyProxyToken(token)).resolves.toBeNull();
  });

  async function seedWorkspace(proxyTokenHash: Buffer | null, deletedAt: Date | null = null) {
    const tag = `${Date.now()}-${Math.random()}`;
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `proxy-token-${tag}@open42.test` })
      .returning({ id: dbMod.schema.users.id });
    if (!user) throw new Error('user_insert_failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId: user.id,
        gbrainVersion: process.env.GBRAIN_VERSION ?? '0.31.3',
        status: deletedAt ? 'deleted' : 'ready',
        proxyTokenHash,
        deletedAt,
      })
      .returning({ id: dbMod.schema.workspaces.id });
    if (!workspace) throw new Error('workspace_insert_failed');
    workspaceIds.push(workspace.id);
    return workspace;
  }
});
