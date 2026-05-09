import type { NextApiRequest, NextApiResponse } from 'next';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

export function rejectCrossSiteMutation(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  if (!MUTATION_METHODS.has(req.method ?? '')) return false;

  const origin = firstHeader(req.headers.origin);
  if (!origin || !allowedWebOrigins(req).has(normalizeOrigin(origin))) {
    res.status(403).json({ error: 'csrf_origin_rejected' });
    return true;
  }

  const fetchSite = firstHeader(req.headers['sec-fetch-site']);
  if (fetchSite && !SAFE_FETCH_SITES.has(fetchSite)) {
    res.status(403).json({ error: 'csrf_fetch_site_rejected' });
    return true;
  }

  return false;
}

export function baseProxyHeaders(req: NextApiRequest): Record<string, string> {
  return {
    Cookie: firstHeader(req.headers.cookie) ?? '',
    'User-Agent': firstHeader(req.headers['user-agent']) ?? '',
  };
}

export function mutationProxyHeaders(
  req: NextApiRequest,
  options: { contentType?: string | null; csrf?: boolean } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...baseProxyHeaders(req),
  };
  if (options.contentType !== null) {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }

  const origin = firstHeader(req.headers.origin);
  if (origin) headers.Origin = origin;

  const fetchSite = firstHeader(req.headers['sec-fetch-site']);
  if (fetchSite) headers['Sec-Fetch-Site'] = fetchSite;

  if (options.csrf !== false) {
    headers['X-CSRF-Token'] = firstHeader(req.headers['x-csrf-token']) ?? '';
  }

  return headers;
}

export function apiUrl(): string {
  return (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

export async function sendBackend(res: NextApiResponse, backend: Response): Promise<void> {
  const text = await backend.text();
  res.status(backend.status);
  try {
    res.json(JSON.parse(text));
  } catch {
    res.send(text);
  }
}

export function forwardSetCookie(backend: Response, res: NextApiResponse): void {
  const headers = backend.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  const fallback = backend.headers.get('set-cookie');
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  } else if (fallback) {
    res.setHeader('Set-Cookie', fallback);
  }
}

function allowedWebOrigins(req: NextApiRequest): Set<string> {
  const origins = new Set<string>();
  const configured = process.env.WEB_PUBLIC_URL ?? process.env.NEXT_PUBLIC_OPEN42_APP_URL;
  if (configured) origins.add(normalizeOrigin(configured));

  const host = firstHeader(req.headers['x-forwarded-host']) ?? firstHeader(req.headers.host);
  if (host) {
    const proto =
      firstHeader(req.headers['x-forwarded-proto']) ??
      (process.env.NODE_ENV === 'production' ? 'https' : 'http');
    origins.add(normalizeOrigin(`${proto}://${host}`));
  }

  return origins;
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
