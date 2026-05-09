import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '../../../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const query = new URLSearchParams();
  if (typeof req.query.limit === 'string') query.set('limit', req.query.limit);
  if (typeof req.query.cursor === 'string') query.set('cursor', req.query.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(String(req.query.id))}/ingest/jobs${suffix}`,
    {
      headers: baseProxyHeaders(req),
    },
  );
  await sendBackend(res, backend);
}
