import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Web-tier liveness check. Doesn't talk to the API or DB on purpose —
 * use /backend/healthz for the deeper check (proxied to apps/api).
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ ok: true, tier: 'web' });
}
