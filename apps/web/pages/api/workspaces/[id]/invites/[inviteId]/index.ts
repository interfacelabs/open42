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

  const wsId = String(req.query.id);
  const inviteId = String(req.query.inviteId);
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/invites/${encodeURIComponent(inviteId)}`,
    {
      method: 'DELETE',
      headers: mutationProxyHeaders(req),
    },
  );
  await sendBackend(res, backend);
}
