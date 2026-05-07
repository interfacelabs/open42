import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'PATCH'].includes(req.method ?? '')) {
    res.setHeader('Allow', 'GET, PATCH');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(String(req.query.id))}/ingest`,
    {
      method: req.method,
      headers: req.method === 'GET' ? baseHeaders(req) : mutationHeaders(req),
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
    },
  );
  await sendBackend(res, backend);
}

function baseHeaders(req: NextApiRequest): HeadersInit {
  return {
    Cookie: req.headers.cookie ?? '',
    'User-Agent': req.headers['user-agent'] ?? '',
  };
}

function mutationHeaders(req: NextApiRequest): HeadersInit {
  return {
    ...baseHeaders(req),
    'Content-Type': 'application/json',
    'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
    Origin: String(req.headers.origin ?? process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host}`),
    'Sec-Fetch-Site': String(req.headers['sec-fetch-site'] ?? 'same-origin'),
  };
}

async function sendBackend(res: NextApiResponse, backend: Response) {
  const text = await backend.text();
  res.status(backend.status);
  try {
    res.json(JSON.parse(text));
  } catch {
    res.send(text);
  }
}

function apiUrl() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
