import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '../_lib/proxy-security';

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
  if (rejectCrossSiteMutation(req, res)) return;

  const init: RequestInit =
    req.method === 'GET'
      ? { method: 'GET', headers: baseProxyHeaders(req) }
      : {
          method: req.method,
          headers: mutationProxyHeaders(req),
          body: JSON.stringify(req.body ?? {}),
        };

  const backend = await fetch(`${apiUrl()}/workspaces/credentials`, init);
  await sendBackend(res, backend);
}
