import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const clientId = Array.isArray(req.query.clientId) ? req.query.clientId[0] : req.query.clientId;
  if (!id || !clientId) {
    res.status(400).json({ error: 'workspace_or_client_id_required' });
    return;
  }

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/mcp-proxy/clients/${encodeURIComponent(
      clientId,
    )}`,
    {
      method: 'DELETE',
      headers: mutationProxyHeaders(req),
    },
  );
  await sendBackend(res, backend);
}
