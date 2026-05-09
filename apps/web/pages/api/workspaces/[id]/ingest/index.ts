import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '../../../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'PATCH'].includes(req.method ?? '')) {
    res.setHeader('Allow', 'GET, PATCH');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(String(req.query.id))}/ingest`,
    {
      method: req.method,
      headers: req.method === 'GET' ? baseProxyHeaders(req) : mutationProxyHeaders(req),
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
    },
  );
  await sendBackend(res, backend);
}
