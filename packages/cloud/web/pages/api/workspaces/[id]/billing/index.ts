import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/billing`,
    { headers: baseProxyHeaders(req) },
  );
  await sendBackend(res, backend);
}
