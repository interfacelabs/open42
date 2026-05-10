/**
 * Redis connection management for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * for the bclient (blocking client) used by Workers — without these, Worker
 * blocking commands (BRPOPLPUSH etc.) trigger the wrong retry semantics and
 * jobs can stall. We expose two builders:
 *
 *   - `buildBullClient()` → for Queue / QueueEvents (non-blocking ops)
 *   - `buildBullSubscriber()` → for Worker (blocking ops, must use null retry)
 *
 * Both reuse the same Redis URL but spawn distinct connections per BullMQ's
 * recommendation. We track every connection we create so `closeAll()` can
 * shut them down on SIGTERM.
 */
import IORedis, { type RedisOptions } from 'ioredis';

import { REDIS_URL } from '../env.js';

const tracked = new Set<IORedis>();

const baseOptions: RedisOptions = {
  // ioredis defaults to localhost:6379 if URL parsing fails — we'd rather
  // fail loudly so misconfiguration surfaces at boot.
  lazyConnect: false,
};

/**
 * Connection for BullMQ Queue / QueueEvents (and any non-blocking client).
 * Standard ioredis defaults are fine; ready check is enabled so misconfig
 * surfaces immediately.
 */
export function buildBullClient(): IORedis {
  const conn = new IORedis(REDIS_URL, { ...baseOptions });
  tracked.add(conn);
  conn.once('end', () => tracked.delete(conn));
  return conn;
}

/**
 * Connection for BullMQ Worker / blocking commands. BullMQ explicitly
 * requires `maxRetriesPerRequest: null` and `enableReadyCheck: false` here.
 * Failing to set these is a documented foot-gun.
 */
export function buildBullSubscriber(): IORedis {
  const conn = new IORedis(REDIS_URL, {
    ...baseOptions,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  tracked.add(conn);
  conn.once('end', () => tracked.delete(conn));
  return conn;
}

/**
 * Close every connection we've handed out. Called on SIGTERM so Redis
 * doesn't hold stale sockets while the new process tries to bind.
 */
export async function closeAllRedisConnections(): Promise<void> {
  await Promise.all(
    Array.from(tracked).map((conn) =>
      conn.quit().catch(() => conn.disconnect()),
    ),
  );
  tracked.clear();
}
