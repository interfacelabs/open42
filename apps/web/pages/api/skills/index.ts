import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

/**
 * Mints a new skill from a chat thread (POST /skills on apps/api).
 * Body: { intent: string; threadCitations: Array<{ slug, excerpt, lastUpdated? }> }.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const backend = await fetch(`${apiUrl()}/skills`, {
    method: 'POST',
    headers: mutationProxyHeaders(req),
    body: JSON.stringify(req.body ?? {}),
  });
  await sendBackend(res, backend);
}
