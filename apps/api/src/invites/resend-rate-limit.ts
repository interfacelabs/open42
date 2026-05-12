/**
 * In-memory, per-process rate limiter for the per-invite "resend" endpoint.
 *
 * Window is 60s per invite-id by default. The state lives in this process —
 * a multi-instance deployment will get one window per replica, which is
 * acceptable for v1 (spec D10): the goal is to stop a single tab from
 * mashing the button, not to be a security gate. Replace with Redis or a
 * DB-backed token bucket when we have horizontal scale that matters.
 */
export interface ResendRateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface ResendRateLimiterOptions {
  windowMs?: number;
}

export class ResendRateLimiter {
  private readonly windowMs: number;
  private readonly lastAt = new Map<string, number>();

  constructor(opts: ResendRateLimiterOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
  }

  check(inviteId: string, now: number = Date.now()): ResendRateLimitResult {
    const last = this.lastAt.get(inviteId);
    if (last === undefined || now - last >= this.windowMs) {
      this.lastAt.set(inviteId, now);
      return { allowed: true };
    }
    return { allowed: false, retryAfterMs: this.windowMs - (now - last) };
  }
}

/**
 * Module-level singleton used by the per-workspace invite router. In-memory,
 * per-process (see class docstring) — spec D10.
 */
export const sharedResendRateLimiter = new ResendRateLimiter();
