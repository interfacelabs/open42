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
    SET ingest_lock_until = date_trunc(
      'milliseconds',
      now() + (${ACQUIRE_TTL_MIN}::int * interval '1 minute')
    )
    WHERE id = ${workspaceId}
      AND (ingest_lock_until IS NULL OR ingest_lock_until < now())
    RETURNING ingest_lock_until
  `);
  const row = rowsOf<{ ingest_lock_until: Date }>(rows)[0];
  return row?.ingest_lock_until ?? null;
}

export async function heartbeatLock(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<Date | null> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = date_trunc(
      'milliseconds',
      now() + (${HEARTBEAT_TTL_MIN}::int * interval '1 minute')
    )
    WHERE id = ${workspaceId}
      AND ingest_lock_until = date_trunc('milliseconds', ${expectedLease}::timestamptz)
    RETURNING ingest_lock_until
  `);
  const row = rowsOf<{ ingest_lock_until: Date }>(rows)[0];
  return row?.ingest_lock_until ?? null;
}

export async function releaseLockOnSuccess(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL, ingest_last_cycle_at = date_trunc('milliseconds', now())
    WHERE id = ${workspaceId}
      AND ingest_lock_until = date_trunc('milliseconds', ${expectedLease}::timestamptz)
    RETURNING id
  `);
  return rowsOf<{ id: string }>(rows).length > 0;
}

export async function releaseLockWithoutAdvancing(
  db: typeof Db,
  workspaceId: string,
  expectedLease: Date,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL
    WHERE id = ${workspaceId}
      AND ingest_lock_until = date_trunc('milliseconds', ${expectedLease}::timestamptz)
    RETURNING id
  `);
  return rowsOf<{ id: string }>(rows).length > 0;
}

export async function reclaimExpiredLocks(db: typeof Db): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE workspaces
    SET ingest_lock_until = NULL
    WHERE ingest_lock_until IS NOT NULL AND ingest_lock_until < now()
    RETURNING id
  `);
  return rowsOf<unknown>(rows).length;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
