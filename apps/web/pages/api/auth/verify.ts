import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const backend = await fetch(`${apiUrl()}/auth/verify`, {
    method: 'POST',
    headers: proxyHeaders(req),
    body: JSON.stringify(req.body),
  });
  forwardSetCookie(backend, res);
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

function forwardSetCookie(backend: Response, res: NextApiResponse) {
  const headers = backend.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  const fallback = backend.headers.get('set-cookie');
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  } else if (fallback) {
    res.setHeader('Set-Cookie', fallback);
  }
}
