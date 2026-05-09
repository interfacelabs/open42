import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '../../../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(String(req.query.id))}/ingest/sync`,
    {
      method: 'POST',
      headers: mutationProxyHeaders(req),
    },
  );
  await sendBackend(res, backend);
}
