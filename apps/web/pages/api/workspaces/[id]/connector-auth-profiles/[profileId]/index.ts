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
  const profileId = String(req.query.profileId);
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(
      wsId,
    )}/connector-auth-profiles/${encodeURIComponent(profileId)}`,
    {
      method: 'DELETE',
      headers: mutationProxyHeaders(req),
    },
  );
  await sendBackend(res, backend);
}
