import { sql } from 'drizzle-orm';
import type { db as Db } from '../db/client.js';

const ACQUIRE_TTL_MIN = 30;
const HEARTBEAT_TTL_MIN = 5;

export async function acquireWorkspaceLock(
  db: typeof Db,
  workspaceId: string,
): Promise<Date | null> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = now() + interval '${sql.raw(String(ACQUIRE_TTL_MIN))} minutes'
    WHERE id = ${workspaceId}
      AND (ingest_lock_until IS NULL OR ingest_lock_until < now())
    RETURNING ingest_lock_until
  `);
  const row = (rows as unknown as { rows: Array<{ ingest_lock_until: Date }> }).rows[0];
  return row?.ingest_lock_until ?? null;
}

export async function heartbeatLock(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<Date | null> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = now() + interval '${sql.raw(String(HEARTBEAT_TTL_MIN))} minutes'
    WHERE id = ${workspaceId} AND ingest_lock_until = ${expectedLease}
    RETURNING ingest_lock_until
  `);
  const row = (rows as unknown as { rows: Array<{ ingest_lock_until: Date }> }).rows[0];
  return row?.ingest_lock_until ?? null;
}

export async function releaseLockOnSuccess(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL, ingest_last_cycle_at = now()
    WHERE id = ${workspaceId} AND ingest_lock_until = ${expectedLease}
    RETURNING id
  `);
  return (rows as unknown as { rows: Array<{ id: string }> }).rows.length > 0;
}

export async function releaseLockWithoutAdvancing(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL
    WHERE id = ${workspaceId} AND ingest_lock_until = ${expectedLease}
    RETURNING id
  `);
  return (rows as unknown as { rows: Array<{ id: string }> }).rows.length > 0;
}

export async function reclaimExpiredLocks(db: typeof Db): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL
    WHERE ingest_lock_until IS NOT NULL AND ingest_lock_until < now()
    RETURNING id
  `);
  return (rows as unknown as { rows: unknown[] }).rows.length;
}
