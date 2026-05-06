import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  acquireWorkspaceLock,
  heartbeatLock,
  releaseLockOnSuccess,
  releaseLockWithoutAdvancing,
} from './locks.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

type DbModule = typeof import('../db/client.js');
let db: DbModule['db'];
let schema: DbModule['schema'];

async function makeWorkspace(): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `t+${Date.now()}-${Math.random()}@x.test` })
    .returning();
  if (!user) throw new Error('insert user failed');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      ownerUserId: user.id,
      gbrainVersion: 'test-0.0.0',
    })
    .returning();
  if (!ws) throw new Error('insert workspace failed');
  return ws.id;
}

describeDb('workspace ingest lock', () => {
  let workspaceId = '';

  beforeAll(async () => {
    const mod = await import('../db/client.js');
    db = mod.db;
    schema = mod.schema;
  });

  beforeEach(async () => {
    workspaceId = await makeWorkspace();
  });

  afterEach(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  });

  it('acquireWorkspaceLock succeeds when free; second attempt fails', async () => {
    const first = await acquireWorkspaceLock(db, workspaceId);
    expect(first).not.toBeNull();
    const second = await acquireWorkspaceLock(db, workspaceId);
    expect(second).toBeNull();
  });

  it('heartbeatLock extends the lease when caller still owns it', async () => {
    const lease = await acquireWorkspaceLock(db, workspaceId);
    expect(lease).not.toBeNull();
    const newLease = await heartbeatLock(db, workspaceId, lease!);
    expect(newLease).not.toBeNull();
    expect(newLease!.getTime()).toBeGreaterThan(lease!.getTime());
  });

  it('heartbeatLock returns null when caller no longer owns the lease', async () => {
    const lease = await acquireWorkspaceLock(db, workspaceId);
    expect(lease).not.toBeNull();
    await db
      .update(schema.workspaces)
      .set({ ingestLockUntil: new Date(Date.now() + 60_000) })
      .where(eq(schema.workspaces.id, workspaceId));
    const result = await heartbeatLock(db, workspaceId, lease!);
    expect(result).toBeNull();
  });

  it('releaseLockOnSuccess clears ingest_lock_until and stamps ingest_last_cycle_at', async () => {
    const lease = await acquireWorkspaceLock(db, workspaceId);
    expect(lease).not.toBeNull();
    const ok = await releaseLockOnSuccess(db, workspaceId, lease!);
    expect(ok).toBe(true);
    const [w] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    expect(w?.ingestLockUntil).toBeNull();
    expect(w?.ingestLastCycleAt).not.toBeNull();
  });

  it('releaseLockWithoutAdvancing clears the lock without touching ingest_last_cycle_at', async () => {
    const lease = await acquireWorkspaceLock(db, workspaceId);
    expect(lease).not.toBeNull();
    const ok = await releaseLockWithoutAdvancing(db, workspaceId, lease!);
    expect(ok).toBe(true);
    const [w] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    expect(w?.ingestLockUntil).toBeNull();
    expect(w?.ingestLastCycleAt).toBeNull();
  });
});
