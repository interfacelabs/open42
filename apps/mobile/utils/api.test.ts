import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearCookieJar: vi.fn(async () => undefined),
  getItem: vi.fn(async () => null as string | null),
  globalFetch: vi.fn(),
  polyfillEncoding: vi.fn(),
  polyfillReadableStream: vi.fn(),
  removeItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
  streamingFetch: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
    setItem: mocks.setItem,
  },
}));

vi.mock('react-native-fetch-api', () => ({
  fetch: mocks.streamingFetch,
}));

vi.mock('react-native-polyfill-globals/src/encoding', () => ({
  polyfill: mocks.polyfillEncoding,
}));

vi.mock('react-native-polyfill-globals/src/readable-stream', () => ({
  polyfill: mocks.polyfillReadableStream,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getItem.mockResolvedValue(null);
  mocks.globalFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  mocks.streamingFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', mocks.globalFetch);
  process.env.EXPO_PUBLIC_OPEN42_API_URL = 'https://api.open42.test';
});

it('uses the platform fetch for ordinary API requests', async () => {
  const { rawApiFetch } = await import('./api');

  await rawApiFetch('/workspaces/current');

  expect(mocks.globalFetch).toHaveBeenCalledTimes(1);
  expect(mocks.streamingFetch).not.toHaveBeenCalled();
});

it('sends stored Open42 cookies, CSRF, and JSON bodies to the configured API URL', async () => {
  mocks.getItem.mockResolvedValue(
    JSON.stringify({ open42_session: 'session-1', open42_csrf: 'csrf-1' })
  );
  const { rawApiFetch } = await import('./api');

  await rawApiFetch('/api/workspaces/ws-1/invites', {
    method: 'POST',
    body: { emails: ['ana@open42.test'] },
  });

  const [url, init] = mocks.globalFetch.mock.calls[0]!;
  const headers = init.headers as Headers;
  expect(url).toBe('https://api.open42.test/workspaces/ws-1/invites');
  expect(headers.get('Cookie')).toBe('open42_session=session-1; open42_csrf=csrf-1');
  expect(headers.get('x-csrf-token')).toBe('csrf-1');
  expect(headers.get('Origin')).toBe('https://api.open42.test');
  expect(headers.get('sec-fetch-site')).toBe('same-origin');
  expect(headers.get('Content-Type')).toBe('application/json');
  expect(init.body).toBe(JSON.stringify({ emails: ['ana@open42.test'] }));
  expect(init.credentials).toBe('include');
});

it('persists only Open42 set-cookie values back into the mobile cookie jar', async () => {
  mocks.globalFetch.mockResolvedValue({
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'set-cookie'
          ? 'open42_session=session-2; Path=/; HttpOnly, open42_csrf=csrf-2; Path=/, analytics=ignored; Path=/'
          : null,
    },
  } as Response);
  const { rawApiFetch } = await import('./api');

  await rawApiFetch('/workspaces/current');

  expect(mocks.setItem).toHaveBeenCalledWith(
    'open42.mobile.cookies',
    JSON.stringify({ open42_session: 'session-2', open42_csrf: 'csrf-2' })
  );
});

it('clears the cookie jar and calls the unauthorized handler on 401', async () => {
  const unauthorized = vi.fn();
  mocks.globalFetch.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
  const { rawApiFetch, setUnauthorizedHandler } = await import('./api');
  setUnauthorizedHandler(unauthorized);

  await rawApiFetch('/workspaces/current');

  expect(mocks.removeItem).toHaveBeenCalledWith('open42.mobile.cookies');
  expect(unauthorized).toHaveBeenCalledTimes(1);

  setUnauthorizedHandler(null);
});

it('uses the React Native streaming fetch when text streaming is requested', async () => {
  const { rawApiFetch } = await import('./api');

  await rawApiFetch('/chat', {
    method: 'POST',
    reactNative: { textStreaming: true },
    body: { query: 'What changed?', workspace_id: 'ws-1' },
  });

  expect(mocks.streamingFetch).toHaveBeenCalledTimes(1);
  expect(mocks.globalFetch).not.toHaveBeenCalled();
  expect(mocks.streamingFetch.mock.calls[0]?.[1]).toMatchObject({
    reactNative: { textStreaming: true },
  });
});

it('consumes NDJSON events from split ReadableStream chunks', async () => {
  const { consumeNdjson } = await import('./api');
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('{"type":"citations","citations":[]}\n{"type":"tok'),
    encoder.encode('en","text":"hello"}\n{"type":"done"}\n'),
  ];
  const response = {
    body: {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: chunks[0] })
          .mockResolvedValueOnce({ done: false, value: chunks[1] })
          .mockResolvedValueOnce({ done: true }),
      }),
    },
  } as unknown as Response;
  const events: { type: string; text?: string }[] = [];

  await consumeNdjson(response, (event: { type: string; text?: string }) => events.push(event));

  expect(events).toEqual([
    { type: 'citations', citations: [] },
    { type: 'token', text: 'hello' },
    { type: 'done' },
  ]);
});

it('consumes NDJSON from buffered responses when streaming is unavailable', async () => {
  const { consumeNdjson } = await import('./api');
  const response = new Response('{"type":"token","text":"fallback"}\n{"type":"done"}\n');
  const events: { type: string; text?: string }[] = [];

  await consumeNdjson(response, (event: { type: string; text?: string }) => events.push(event));

  expect(events).toEqual([{ type: 'token', text: 'fallback' }, { type: 'done' }]);
});
