import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const backend = await fetch(`${apiUrl()}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: req.headers.cookie ?? '',
      'User-Agent': req.headers['user-agent'] ?? '',
      Origin: process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host ?? 'localhost:3000'}`,
      'Sec-Fetch-Site': 'same-origin',
      'X-CSRF-Token': String(req.headers['x-csrf-token'] ?? ''),
    },
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

function apiUrl() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
