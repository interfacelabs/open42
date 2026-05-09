import type { NextApiRequest, NextApiResponse } from 'next';

import {
  apiUrl,
  mutationProxyHeaders,
  rejectCrossSiteMutation,
  sendBackend,
} from '@/lib/proxy-security';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (rejectCrossSiteMutation(req, res)) return;

  const headers = mutationProxyHeaders(req, { contentType: null });
  if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type']);
  if (req.headers['content-length']) {
    headers['Content-Length'] = String(req.headers['content-length']);
  }

  const backend = await fetch(`${apiUrl()}/connections/notion-zip`, {
    method: 'POST',
    headers,
    body: req as unknown as ReadableStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await sendBackend(res, backend);
}
