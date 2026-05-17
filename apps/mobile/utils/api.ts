import AsyncStorage from '@react-native-async-storage/async-storage';

const COOKIE_KEY = 'open42.mobile.cookies';

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    super(
      typeof payload === 'object' && payload && 'error' in payload
        ? String(payload.error)
        : 'api_error'
    );
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type CookieJar = Record<string, string>;
type JsonInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
  rawBody?: BodyInit;
  reactNative?: {
    textStreaming?: boolean;
  };
};

let unauthorizedHandler: (() => void) | null = null;
let streamingFetchImpl: typeof fetch | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function apiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_OPEN42_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

export async function apiFetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const response = await rawApiFetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}

export async function rawApiFetch(path: string, init: JsonInit = {}): Promise<Response> {
  const url = `${apiBaseUrl()}${normalizePath(path)}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const cookies = await readCookieJar();
  const headers = new Headers(init.headers);
  const origin = originFor(url);

  if (Object.keys(cookies).length > 0) {
    headers.set('Cookie', serializeCookieJar(cookies));
  }
  if (!headers.has('Origin')) headers.set('Origin', origin);
  if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');
  if (isMutation(method) && cookies.open42_csrf && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', cookies.open42_csrf);
  }

  let body: BodyInit | undefined;
  if (init.rawBody) {
    body = init.rawBody;
  } else if (init.body !== undefined) {
    headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
    body = JSON.stringify(init.body);
  }

  const fetchImpl = init.reactNative?.textStreaming ? await getStreamingFetch() : fetch;
  const response = await fetchImpl(url, {
    ...init,
    method,
    headers,
    body,
    credentials: 'include',
  } as RequestInit);
  await persistSetCookies(response.headers);
  if (response.status === 401) {
    await clearCookieJar();
    unauthorizedHandler?.();
  }
  return response;
}

async function getStreamingFetch(): Promise<typeof fetch> {
  if (streamingFetchImpl) return streamingFetchImpl;
  const [{ fetch: streamingFetch }, encoding, readableStream] = await Promise.all([
    import('react-native-fetch-api'),
    import('react-native-polyfill-globals/src/encoding'),
    import('react-native-polyfill-globals/src/readable-stream'),
  ]);
  encoding.polyfill();
  readableStream.polyfill();
  streamingFetchImpl = streamingFetch as unknown as typeof fetch;
  return streamingFetchImpl;
}

export async function consumeNdjson<T>(
  response: Response,
  onEvent: (event: T) => void
): Promise<void> {
  const body = response.body as unknown as { getReader?: () => unknown } | null;
  if (!body?.getReader) {
    parseNdjsonLines(await response.text(), onEvent);
    return;
  }
  const reader = body.getReader() as {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    parseNdjsonLines(lines.join('\n'), onEvent);
  }
  parseNdjsonLines(buffer, onEvent);
}

export async function apiFetcher<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export async function clearCookieJar(): Promise<void> {
  await AsyncStorage.removeItem(COOKIE_KEY);
}

export async function readCookieJar(): Promise<CookieJar> {
  const raw = await AsyncStorage.getItem(COOKIE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as CookieJar;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeCookieJar(cookies: CookieJar): Promise<void> {
  await AsyncStorage.setItem(COOKIE_KEY, JSON.stringify(cookies));
}

async function persistSetCookies(headers: Headers): Promise<void> {
  const values = getSetCookieValues(headers);
  if (values.length === 0) return;
  const jar = await readCookieJar();
  for (const header of values) {
    const [pair] = header.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name.startsWith('open42_')) continue;
    if (!value || /expires=Thu, 01 Jan 1970/i.test(header)) {
      delete jar[name];
    } else {
      jar[name] = value;
    }
  }
  await writeCookieJar(jar);
}

function getSetCookieValues(headers: Headers): string[] {
  const maybeHeaders = headers as Headers & {
    getSetCookie?: () => string[];
    map?: Record<string, string>;
  };
  const direct = maybeHeaders.getSetCookie?.();
  if (direct && direct.length > 0) return direct;
  const single = headers.get('set-cookie') ?? maybeHeaders.map?.['set-cookie'];
  return single ? splitSetCookie(single) : [];
}

function splitSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim());
}

function serializeCookieJar(cookies: CookieJar): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.startsWith('/api/') ? withSlash.slice(4) : withSlash;
}

function originFor(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return apiBaseUrl();
  }
}

function isMutation(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function parseNdjsonLines<T>(value: string, onEvent: (event: T) => void): void {
  for (const line of value.split('\n')) {
    if (!line.trim()) continue;
    onEvent(JSON.parse(line) as T);
  }
}
