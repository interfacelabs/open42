import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const headers: Record<string, string> = {
    Cookie: req.headers.cookie ?? '',
    'User-Agent': req.headers['user-agent'] ?? '',
    'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
    Origin: String(req.headers.origin ?? process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host}`),
    'Sec-Fetch-Site': String(req.headers['sec-fetch-site'] ?? 'same-origin'),
  };
  if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type']);
  if (req.headers['content-length']) {
    headers['Content-Length'] = String(req.headers['content-length']);
  }

  const backend = await fetch(`${apiUrl()}/connections/notion-zip`, {
    method: 'POST',
    headers,
    body: req as unknown as ReadableStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await sendBackend(res, backend);
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
