import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWaitlistRouter,
  resetWaitlistRateLimitForTest,
  type WaitlistEntryInput,
} from './waitlist.js';

describe('waitlist routes', () => {
  beforeEach(() => {
    resetWaitlistRateLimitForTest();
  });

  it('stores normalized beta access requests without echoing the email', async () => {
    const stored: WaitlistEntryInput[] = [];
    const notified: WaitlistEntryInput[] = [];
    const app = express();
    app.use(express.json());
    app.use(
      buildWaitlistRouter({
        repo: {
          async upsert(input) {
            stored.push(input);
          },
        },
        notifier: {
          async notify(input) {
            notified.push(input);
            return { ok: true };
          },
        },
      }),
    );

    const res = await request(app)
      .post('/')
      .set('User-Agent', 'waitlist-test')
      .set('fly-client-ip', '203.0.113.10')
      .send({ email: ' Founder@Example.COM ', source: 'Landing Page' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(JSON.stringify(res.body)).not.toContain('Founder@Example.COM');
    expect(stored).toEqual([
      {
        email: 'founder@example.com',
        source: 'landing-page',
        userAgent: 'waitlist-test',
        ip: '203.0.113.10',
      },
    ]);
    await vi.waitFor(() => {
      expect(notified).toEqual(stored);
    });
  });

  it('rejects invalid email addresses before storing', async () => {
    const upsert = vi.fn();
    const notify = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(buildWaitlistRouter({ repo: { upsert }, notifier: { notify } }));

    const res = await request(app).post('/').send({ email: 'not-an-email', source: 'landing' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
    expect(upsert).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the beta request accepted when operator notification fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = express();
    app.use(express.json());
    app.use(
      buildWaitlistRouter({
        repo: { upsert: vi.fn(async () => undefined) },
        notifier: {
          async notify() {
            return { ok: false, error: 'email_provider_not_configured' };
          },
        },
      }),
    );

    const res = await request(app)
      .post('/')
      .set('fly-client-ip', '203.0.113.15')
      .send({ email: 'founder@example.com', source: 'landing' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[waitlist-notification-failed]',
        expect.objectContaining({ error: 'email_provider_not_configured' }),
      );
    });
    warn.mockRestore();
  });

  it('rate limits repeated submissions from the same address', async () => {
    const app = express();
    app.use(express.json());
    app.use(buildWaitlistRouter({ repo: { upsert: vi.fn(async () => undefined) } }));

    for (let index = 0; index < 20; index += 1) {
      const res = await request(app)
        .post('/')
        .set('fly-client-ip', '203.0.113.20')
        .send({ email: `founder-${index}@example.com`, source: 'landing' });
      expect(res.status).toBe(202);
    }

    const limited = await request(app)
      .post('/')
      .set('fly-client-ip', '203.0.113.20')
      .send({ email: 'founder-21@example.com', source: 'landing' });

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'waitlist_rate_limited' });
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
