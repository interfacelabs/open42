import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '@/lib/proxy-security';

/**
 * Library list proxy. Forwards GET to the backend
 * `/workspaces/:id/library` route. The workspace id rides in the URL so the
 * API can enforce membership via `requireMembership({ from: 'param' })`
 * instead of resolving "first owned workspace" non-deterministically.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }

  const params = new URLSearchParams();
  const collection = firstQuery(req.query.collection);
  const source = firstQuery(req.query.source);
  if (collection) params.set('collection', collection);
  if (source) params.set('source', source);

  const qs = params.toString();
  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/library${qs ? `?${qs}` : ''}`,
    { headers: baseProxyHeaders(req) },
  );
  await sendBackend(res, backend);
}

function firstQuery(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
