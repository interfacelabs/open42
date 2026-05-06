import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const backend = await fetch(`${apiUrl()}/connections/init`, {
    method: 'POST',
    headers: mutationHeaders(req),
    body: JSON.stringify(req.body ?? {}),
  });
  await sendBackend(res, backend);
}

function mutationHeaders(req: NextApiRequest): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
    Cookie: req.headers.cookie ?? '',
    'User-Agent': req.headers['user-agent'] ?? '',
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
