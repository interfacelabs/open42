import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
} from '@/lib/proxy-security';

/**
 * Download the latest persisted skill version as a zip (POST /skills/:id on
 * apps/api). The legacy /api/skills/refund-policy.ts handles the same verb
 * for the hardcoded refund-policy id; static routes win in Next.js so this
 * dynamic route only fires for fresh, mint-created skill ids.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const backend = await fetch(`${apiUrl()}/skills/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: mutationProxyHeaders(req),
  });

  // Stream the zip back unmodified — sendBackend always tries JSON-parses
  // which would corrupt a binary body.
  res.status(backend.status);
  for (const [k, v] of backend.headers.entries()) {
    if (k === 'transfer-encoding' || k === 'content-encoding') continue;
    res.setHeader(k, v);
  }
  const buffer = Buffer.from(await backend.arrayBuffer());
  res.end(buffer);
}
