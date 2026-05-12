import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  baseProxyHeaders,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const wsId = String(req.query.id);

  if (req.method === 'GET') {
    // Codex round-4 P3: forward ?status to the backend so /invites?status=all
    // (the documented listing mode that includes accepted+revoked) is
    // reachable from the client. Without this the GET handler dropped the
    // query string and only "pending" rows came back. Pattern mirrors the
    // ingest jobs proxy at apps/web/pages/api/workspaces/[id]/ingest/jobs.ts.
    const query = new URLSearchParams();
    if (typeof req.query.status === 'string') query.set('status', req.query.status);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const target = `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/invites${suffix}`;
    const backend = await fetch(target, { headers: baseProxyHeaders(req) });
    await sendBackend(res, backend);
    return;
  }
  if (req.method === 'POST') {
    if (rejectCrossSiteMutation(req, res)) return;
    const target = `${apiUrl()}/workspaces/${encodeURIComponent(wsId)}/invites`;
    const backend = await fetch(target, {
      method: 'POST',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    });
    await sendBackend(res, backend);
    return;
  }
  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
}
