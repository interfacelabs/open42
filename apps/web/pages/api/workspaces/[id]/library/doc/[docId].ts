import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '@/lib/proxy-security';

/**
 * Library doc-detail proxy. Forwards GET to the backend
 * `/workspaces/:id/library/doc/:docId`. The workspace id rides in the URL
 * so the API can enforce membership via `requireMembership`.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const docId = Array.isArray(req.query.docId) ? req.query.docId[0] : req.query.docId;
  if (!id) {
    res.status(400).json({ error: 'workspace_id_required' });
    return;
  }
  if (!docId) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const backend = await fetch(
    `${apiUrl()}/workspaces/${encodeURIComponent(id)}/library/doc/${encodeURIComponent(docId)}`,
    { headers: baseProxyHeaders(req) },
  );
  await sendBackend(res, backend);
}
