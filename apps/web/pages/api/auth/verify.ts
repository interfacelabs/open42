import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  forwardSetCookie,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const body = req.body ?? {};
  const forwarded = {
    accessToken: body.accessToken,
    tokenHash: body.tokenHash,
    type: body.type,
    email: body.email,
    token: body.token,
    inviteId: body.inviteId,
  };
  const backend = await fetch(`${apiUrl()}/auth/verify`, {
    method: 'POST',
    headers: mutationProxyHeaders(req, { csrf: false }),
    body: JSON.stringify(forwarded),
  });
  forwardSetCookie(backend, res);
  res.status(backend.status).json(await backend.json());
}
