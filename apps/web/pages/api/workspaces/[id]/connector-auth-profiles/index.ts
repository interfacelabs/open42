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

  const wsId = String(req.query.id);
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/connector-auth-profiles`,
    {
      method: req.method,
      headers: req.method === 'GET' ? baseProxyHeaders(req) : mutationProxyHeaders(req),
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
    },
  );
  await sendBackend(res, backend);
}
