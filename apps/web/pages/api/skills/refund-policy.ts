import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const backend = await fetch(`${apiUrl()}/skills/refund-policy`, {
    method: 'POST',
    headers: {
      Cookie: req.headers.cookie ?? '',
      'User-Agent': req.headers['user-agent'] ?? '',
      Origin: process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host ?? 'localhost:3000'}`,
      'Sec-Fetch-Site': 'same-origin',
      'X-CSRF-Token': String(req.headers['x-csrf-token'] ?? ''),
    },
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

function apiUrl() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
