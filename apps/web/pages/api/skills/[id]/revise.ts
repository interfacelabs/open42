import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

/**
 * Revises an existing skill (POST /skills/:id/revise on apps/api). Body:
 * `{ text: string }` — the user's free-form revision request.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const backend = await fetch(
    `${apiUrl()}/skills/${encodeURIComponent(id)}/revise`,
    {
      method: 'POST',
      headers: mutationProxyHeaders(req),
      body: JSON.stringify(req.body ?? {}),
    },
  );
  await sendBackend(res, backend);
}
