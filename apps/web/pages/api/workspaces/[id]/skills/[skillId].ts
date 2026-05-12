import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
} from '@/lib/proxy-security';

/**
 * Skill download proxy — POST `/workspaces/:id/skills/:skillId` on the
 * backend. Streams the zip back unmodified (sendBackend tries to JSON-parse,
 * which would corrupt a binary body).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const skillId = Array.isArray(req.query.skillId)
    ? req.query.skillId[0]
    : req.query.skillId;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }
  if (!skillId) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: 'POST',
      headers: mutationProxyHeaders(req),
    },
  );

  // Stream the zip back unmodified.
  res.status(backend.status);
  for (const [k, v] of backend.headers.entries()) {
    if (k === 'transfer-encoding' || k === 'content-encoding') continue;
    res.setHeader(k, v);
  }
  const buffer = Buffer.from(await backend.arrayBuffer());
  res.end(buffer);
}
