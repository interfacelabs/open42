import { Router } from 'express';
import { sql } from 'drizzle-orm';

import { db } from '../db/client.js';

export interface HealthzRouterOptions {
  notReady?: () => boolean;
}

export const healthzRouter = buildHealthzRouter();

export function buildHealthzRouter(options: HealthzRouterOptions = {}) {
  const router = Router();

  /**
   * Liveness + DB connectivity check.
   * Returns ok=true only if a trivial Postgres query succeeds.
   */
  router.get('/', async (_req, res) => {
    try {
      const result = await db.execute(sql`SELECT 1 as ping`);
      const ok = Array.isArray(result.rows) && result.rows.length > 0;
      res.status(ok ? 200 : 503).json({
        ok,
        tier: 'api',
        db: ok ? 'reachable' : 'unreachable',
        ...(options.notReady?.() ? { not_ready: true } : {}),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        tier: 'api',
        db: 'error',
        error: err instanceof Error ? err.message : 'unknown',
        ...(options.notReady?.() ? { not_ready: true } : {}),
      });
    }
  });

  return router;
}
