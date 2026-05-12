import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const wsId = String(req.query.id);
  const userId = String(req.query.userId);
  const target = `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`;

  if (req.method === 'PATCH') {
    if (rejectCrossSiteMutation(req, res)) return;
    const backend = await fetch(target, {
      method: 'PATCH',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    });
    await sendBackend(res, backend);
    return;
  }
  if (req.method === 'DELETE') {
    if (rejectCrossSiteMutation(req, res)) return;
    const backend = await fetch(target, {
      method: 'DELETE',
      headers: mutationProxyHeaders(req),
    });
    await sendBackend(res, backend);
    return;
  }
  res.setHeader('Allow', 'PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
}
