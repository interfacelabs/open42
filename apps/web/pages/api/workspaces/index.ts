import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const backend = await fetch(`${apiUrl()}/workspaces`, {
      headers: baseProxyHeaders(req),
    });
    await sendBackend(res, backend);
    return;
  }
  if (req.method === 'POST') {
    if (rejectCrossSiteMutation(req, res)) return;
    const backend = await fetch(`${apiUrl()}/workspaces`, {
      method: 'POST',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    });
    await sendBackend(res, backend);
    return;
  }
  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
}
