import { describe, expect, it, vi } from 'vitest';
import type { NextApiResponse } from 'next';

import { forwardSetCookie } from './proxy-security';

function responseWithHeaderSpy() {
  return {
    setHeader: vi.fn(),
  } as unknown as NextApiResponse & { setHeader: ReturnType<typeof vi.fn> };
}

describe('forwardSetCookie', () => {
  it('forwards runtime-provided Set-Cookie entries as separate headers', () => {
    const res = responseWithHeaderSpy();
    const backend = {
      headers: {
        getSetCookie: () => ['open42_session=session-id; Path=/', 'open42_csrf=csrf; Path=/'],
        get: () => null,
      },
    } as unknown as Response;

    forwardSetCookie(backend, res);

    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', [
      'open42_session=session-id; Path=/',
      'open42_csrf=csrf; Path=/',
    ]);
  });

  it('splits a combined fallback Set-Cookie header without breaking Expires commas', () => {
    const res = responseWithHeaderSpy();
    const combined =
      'open42_session=session-id; Path=/; Expires=Wed, 17 Jun 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax, open42_csrf=csrf-token; Path=/; Expires=Wed, 17 Jun 2026 10:00:00 GMT; Secure; SameSite=Lax';
    const backend = {
      headers: {
        get: (name: string) => (name === 'set-cookie' ? combined : null),
      },
    } as unknown as Response;

    forwardSetCookie(backend, res);

    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', [
      'open42_session=session-id; Path=/; Expires=Wed, 17 Jun 2026 10:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
      'open42_csrf=csrf-token; Path=/; Expires=Wed, 17 Jun 2026 10:00:00 GMT; Secure; SameSite=Lax',
    ]);
  });
});
