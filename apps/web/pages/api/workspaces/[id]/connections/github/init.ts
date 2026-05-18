import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const wsId = String(req.query.id);
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/connections/github/init`,
    {
      method: 'POST',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    },
  );
  await sendBackend(res, backend);
}
