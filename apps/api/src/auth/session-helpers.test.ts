import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ validateSession: vi.fn() }));
vi.mock('./sessions.js', () => ({ validateSession: mocks.validateSession }));

import { readSession } from './session-helpers.js';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'open42_session';

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/test', async (req, res) => {
    res.json({ session: await readSession(req) });
  });
  return app;
}

describe('readSession', () => {
  beforeEach(() => {
    mocks.validateSession.mockReset();
  });

  it('returns null when no cookie is present', async () => {
    const res = await request(makeApp()).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
    expect(mocks.validateSession).not.toHaveBeenCalled();
  });

  it('returns null when validateSession returns null', async () => {
    mocks.validateSession.mockResolvedValue(null);
    const res = await request(makeApp())
      .get('/test')
      .set('Cookie', `${SESSION_COOKIE}=invalid-cookie`);
    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
    expect(mocks.validateSession).toHaveBeenCalledTimes(1);
    expect(mocks.validateSession).toHaveBeenCalledWith(
      'invalid-cookie',
      expect.any(Object),
    );
  });

  it('returns { id, userId } on a valid session', async () => {
    mocks.validateSession.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      expiresAt: new Date(),
      csrfToken: 'csrf',
      userAgent: null,
      ipFirstOctet: null,
    });
    const res = await request(makeApp())
      .get('/test')
      .set('Cookie', `${SESSION_COOKIE}=valid-cookie`);
    expect(res.status).toBe(200);
    expect(res.body.session).toEqual({ id: 'sess-1', userId: 'user-1' });
  });
});
