import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '@/lib/proxy-security';

/**
 * GET `/workspaces/:id/skills/:skillId/draft` proxy — returns the latest
 * persisted draft for a workspace-owned skill.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

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
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}/draft`,
    { headers: baseProxyHeaders(req) },
  );
  await sendBackend(res, backend);
}
