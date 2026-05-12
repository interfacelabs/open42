import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

/**
 * BYOK credentials proxy. Forwards GET / POST / DELETE to the backend
 * `/workspaces/:id/credentials` route owned by Lane E3. The backend is the
 * sole authority — this handler never touches the secret on disk and
 * never reads it back to the client.
 *
 * The workspace id travels in the URL so the API can enforce membership via
 * `requireMembership({ from: 'param' })`. Previously the backend resolved
 * "first owned workspace" non-deterministically — broken under multi-workspace.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }

  const init: RequestInit =
    req.method === 'GET'
      ? { method: 'GET', headers: baseProxyHeaders(req) }
      : {
          method: req.method,
          headers: mutationProxyHeaders(req),
          body: JSON.stringify(req.body ?? {}),
        };

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/credentials`,
    init,
  );
  await sendBackend(res, backend);
}
