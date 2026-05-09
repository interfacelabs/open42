import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * BYOK credentials proxy. Forwards GET / POST / DELETE to the backend
 * `/workspaces/credentials` route owned by Lane E3. The backend is the
 * sole authority — this handler never touches the secret on disk and
 * never reads it back to the client.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const init: RequestInit =
    req.method === 'GET'
      ? { method: 'GET', headers: baseHeaders(req) }
      : {
          method: req.method,
          headers: mutationHeaders(req),
          body: JSON.stringify(req.body ?? {}),
        };

  const backend = await fetch(`${apiUrl()}/workspaces/credentials`, init);
  await sendBackend(res, backend);
}

function baseHeaders(req: NextApiRequest): HeadersInit {
  return {
    Cookie: req.headers.cookie ?? '',
    'User-Agent': String(req.headers['user-agent'] ?? ''),
  };
}

function mutationHeaders(req: NextApiRequest): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': String(req.headers['x-csrf-token'] ?? ''),
    Cookie: req.headers.cookie ?? '',
    'User-Agent': String(req.headers['user-agent'] ?? ''),
    Origin: String(
      req.headers.origin ?? process.env.WEB_PUBLIC_URL ?? `http://${req.headers.host}`,
    ),
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
