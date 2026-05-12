import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

/**
 * POST `/workspaces/:id/skills/:skillId/revise` proxy. Body: `{ text }` —
 * the user's free-form revision request.
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
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}/revise`,
    {
      method: 'POST',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    },
  );
  await sendBackend(res, backend);
}
