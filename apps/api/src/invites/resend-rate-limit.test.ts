import { beforeEach, describe, expect, it } from 'vitest';

import { ResendRateLimiter } from './resend-rate-limit.js';

describe('ResendRateLimiter', () => {
  let limiter: ResendRateLimiter;
  beforeEach(() => {
    limiter = new ResendRateLimiter({ windowMs: 60_000 });
  });

  it('allows the first hit on a given invite', () => {
    expect(limiter.check('invite-1', 1000)).toEqual({ allowed: true });
  });

  it('rejects a second hit within the window and reports retryAfterMs', () => {
    limiter.check('invite-1', 1000);
    expect(limiter.check('invite-1', 1500)).toEqual({
      allowed: false,
      retryAfterMs: 60_000 - 500,
    });
  });

  it('allows again once the window has expired', () => {
    limiter.check('invite-1', 1000);
    expect(limiter.check('invite-1', 61_001)).toEqual({ allowed: true });
  });

  it('tracks invites independently of each other', () => {
    limiter.check('invite-1', 1000);
    expect(limiter.check('invite-2', 1500)).toEqual({ allowed: true });
  });
});
