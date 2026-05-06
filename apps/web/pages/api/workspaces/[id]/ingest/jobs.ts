import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const query = new URLSearchParams();
  if (typeof req.query.limit === 'string') query.set('limit', req.query.limit);
  if (typeof req.query.cursor === 'string') query.set('cursor', req.query.cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(String(req.query.id))}/ingest/jobs${suffix}`,
    {
      headers: {
        Cookie: req.headers.cookie ?? '',
        'User-Agent': req.headers['user-agent'] ?? '',
      },
    },
  );
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
