import type { NextApiRequest, NextApiResponse } from 'next';

import { apiUrl, baseProxyHeaders, sendBackend } from '@/lib/proxy-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const params = new URLSearchParams();
  const collection = firstQuery(req.query.collection);
  const source = firstQuery(req.query.source);
  if (collection) params.set('collection', collection);
  if (source) params.set('source', source);

  const qs = params.toString();
  const backend = await fetch(
    `${apiUrl()}/library${qs ? `?${qs}` : ''}`,
    { headers: baseProxyHeaders(req) },
  );
  await sendBackend(res, backend);
}

function firstQuery(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
