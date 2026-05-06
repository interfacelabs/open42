import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const backend = await fetch(`${apiUrl()}/auth/signin`, {
    method: 'POST',
    headers: proxyHeaders(req),
    body: JSON.stringify(req.body),
  });
  res.status(backend.status).json(await backend.json());
}

function apiUrl() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function proxyHeaders(req: NextApiRequest): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Origin: process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host ?? 'localhost:3000'}`,
    'Sec-Fetch-Site': 'same-origin',
  };
}
