import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { csrfMiddleware } from './csrf.js';

const ORIGIN = 'http://localhost:6888';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfMiddleware({ allowedOrigins: [ORIGIN] }));
  app.post('/auth/signin', (_req, res) => res.json({ ok: true, route: 'signin' }));
  app.post('/auth/verify', (_req, res) => res.json({ ok: true, route: 'verify' }));
  app.post('/auth/signout', (_req, res) => res.json({ ok: true, route: 'signout' }));
  app.post('/chat', (_req, res) => res.json({ ok: true, route: 'chat' }));
  return app;
}

describe('csrfMiddleware', () => {
  it('rejects mutations with a missing or mismatched Origin', async () => {
    const app = buildApp();
    const noOrigin = await request(app).post('/auth/signin').send({ email: 'a@b.co' });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body).toEqual({ error: 'csrf_origin_rejected' });

    const badOrigin = await request(app)
      .post('/auth/signin')
      .set('Origin', 'http://evil.example')
      .send({ email: 'a@b.co' });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body).toEqual({ error: 'csrf_origin_rejected' });
  });

  it('rejects mutations with cross-site Sec-Fetch-Site', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/signin')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'a@b.co' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'csrf_fetch_site_rejected' });
  });

  it('allows /auth/signin with a stale session cookie and no CSRF token', async () => {
    // Regression: a leftover open42_session cookie from a prior login used to
    // trigger csrf_token_invalid here, blocking re-authentication entirely.
    const app = buildApp();
    const res = await request(app)
      .post('/auth/signin')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=stale-session-id')
      .send({ email: 'a@b.co' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, route: 'signin' });
  });

  it('allows /auth/verify with a stale session cookie and no CSRF token', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/verify')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=stale-session-id')
      .send({ token: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, route: 'verify' });
  });

  it('still requires a CSRF token on authenticated mutations like /chat', async () => {
    const app = buildApp();
    const noToken = await request(app)
      .post('/chat')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=sess-id')
      .send({ msg: 'hi' });
    expect(noToken.status).toBe(403);
    expect(noToken.body).toEqual({ error: 'csrf_token_invalid' });

    const mismatched = await request(app)
      .post('/chat')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=sess-id; open42_csrf=cookie-tok')
      .set('X-CSRF-Token', 'header-tok')
      .send({ msg: 'hi' });
    expect(mismatched.status).toBe(403);
    expect(mismatched.body).toEqual({ error: 'csrf_token_invalid' });

    const matched = await request(app)
      .post('/chat')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=sess-id; open42_csrf=tok-123')
      .set('X-CSRF-Token', 'tok-123')
      .send({ msg: 'hi' });
    expect(matched.status).toBe(200);
    expect(matched.body).toEqual({ ok: true, route: 'chat' });
  });

  it('still requires CSRF token on /auth/signout (authenticated route)', async () => {
    // /auth/signout reads the session cookie, so it is NOT exempt.
    const app = buildApp();
    const res = await request(app)
      .post('/auth/signout')
      .set('Origin', ORIGIN)
      .set('Cookie', 'open42_session=sess-id')
      .send();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'csrf_token_invalid' });
  });

  it('passes through unauthenticated requests with no session cookie', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/chat')
      .set('Origin', ORIGIN)
      .send({ msg: 'hi' });
    expect(res.status).toBe(200);
  });

  it('does not gate non-mutation methods', async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(csrfMiddleware({ allowedOrigins: [ORIGIN] }));
    app.get('/anything', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(200);
  });
});
