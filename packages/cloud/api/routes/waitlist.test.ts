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
    const app = express();
    app.use(express.json());
    app.use(
      buildWaitlistRouter({
        repo: {
          async upsert(input) {
            stored.push(input);
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
  });

  it('rejects invalid email addresses before storing', async () => {
    const upsert = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(buildWaitlistRouter({ repo: { upsert } }));

    const res = await request(app).post('/').send({ email: 'not-an-email', source: 'landing' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
    expect(upsert).not.toHaveBeenCalled();
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
