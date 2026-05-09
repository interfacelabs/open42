import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, mutationProxyHeaders, rejectCrossSiteMutation } from '../_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(`${apiUrl()}/skills/refund-policy`, {
    method: 'POST',
    headers: mutationProxyHeaders(req, { contentType: null }),
  });

  res.statusCode = backend.status;
  backend.headers.forEach((value, key) => {
    if (['content-type', 'content-disposition'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (!backend.ok) {
    res.json(await backend.json());
    return;
  }

  const buffer = Buffer.from(await backend.arrayBuffer());
  res.send(buffer);
}
