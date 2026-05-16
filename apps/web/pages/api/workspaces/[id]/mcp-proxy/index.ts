import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (req.method === 'POST' && rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }

  const init: RequestInit =
    req.method === 'GET'
      ? { method: 'GET', headers: baseProxyHeaders(req) }
      : {
          method: 'POST',
          headers: mutationProxyHeaders(req),
          body: JSON.stringify(req.body ?? {}),
        };

  const backend = await fetch(`${apiUrl()}/workspaces/${encodeURIComponent(id)}/mcp-proxy`, init);
  await sendBackend(res, backend);
}
