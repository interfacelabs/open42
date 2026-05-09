import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const backend = await fetch(`${apiUrl()}/connections`, {
    headers: baseProxyHeaders(req),
  });
  await sendBackend(res, backend);
}
