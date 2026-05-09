import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, mutationProxyHeaders, rejectCrossSiteMutation } from '../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(`${apiUrl()}/auth/signin`, {
    method: 'POST',
    headers: mutationProxyHeaders(req, { csrf: false }),
    body: JSON.stringify(req.body),
  });
  res.status(backend.status).json(await backend.json());
}
