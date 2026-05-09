import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, mutationProxyHeaders, rejectCrossSiteMutation } from './_lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(`${apiUrl()}/chat`, {
    method: 'POST',
    headers: mutationProxyHeaders(req),
    body: JSON.stringify(req.body),
  });

  res.statusCode = backend.status;
  backend.headers.forEach((value, key) => {
    if (['content-type', 'cache-control'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (!backend.body) {
    res.end();
    return;
  }

  const reader = backend.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
