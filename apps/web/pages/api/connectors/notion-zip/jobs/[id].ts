import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const backend = await fetch(`${apiUrl()}/connectors/notion-zip/jobs/${id}`, {
    headers: {
      Cookie: req.headers.cookie ?? '',
      'User-Agent': req.headers['user-agent'] ?? '',
    },
  });
  res.status(backend.status).json(await backend.json());
}

function apiUrl() {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}
