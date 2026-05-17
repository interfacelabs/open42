import { Router } from 'express';

import { db as defaultDb } from '@open42/api/db/client';
import { cloudWaitlistEntries } from '../schema-cloud.js';

const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 64;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimit = new Map<string, RateEntry>();

export interface WaitlistEntryInput {
  email: string;
  source: string;
  userAgent: string | null;
  ip: string | null;
}

export interface WaitlistRepo {
  upsert(input: WaitlistEntryInput): Promise<void>;
}

export function buildWaitlistRouter(deps: { repo?: WaitlistRepo } = {}) {
  const repo = deps.repo ?? defaultWaitlistRepo();
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const ip = clientIp(req);
      const limited = checkRateLimit(ip ?? 'unknown');
      if (!limited.ok) {
        res.setHeader('Retry-After', String(limited.retryAfter));
        res.status(429).json({ error: 'waitlist_rate_limited' });
        return;
      }

      const parsed = parseWaitlistInput(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      await repo.upsert({
        email: parsed.email,
        source: parsed.source,
        userAgent: req.header('user-agent')?.slice(0, 500) ?? null,
        ip,
      });

      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function defaultWaitlistRepo(): WaitlistRepo {
  return {
    async upsert(input) {
      const now = new Date();
      await defaultDb
        .insert(cloudWaitlistEntries)
        .values({
          email: input.email,
          source: input.source,
          userAgent: input.userAgent,
          ip: input.ip,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: cloudWaitlistEntries.email,
          set: {
            source: input.source,
            userAgent: input.userAgent,
            ip: input.ip,
            updatedAt: now,
          },
        });
    },
  };
}

function parseWaitlistInput(
  value: unknown,
): { ok: true; email: string; source: string } | { ok: false; error: string } {
  const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }

  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.:-]+/g, '-')
      : 'landing';

  return { ok: true, email, source: source.slice(0, MAX_SOURCE_LENGTH) || 'landing' };
}

function clientIp(req: { ip?: string; header(name: string): string | undefined }): string | null {
  const forwarded = req.header('fly-client-ip') ?? req.header('cf-connecting-ip') ?? req.ip;
  return forwarded ? forwarded.slice(0, 128) : null;
}

function checkRateLimit(
  key: string,
  nowMs = Date.now(),
): { ok: true } | { ok: false; retryAfter: number } {
  const existing = rateLimit.get(key);
  const entry =
    existing && existing.resetAt > nowMs
      ? existing
      : { count: 0, resetAt: nowMs + RATE_LIMIT_WINDOW_MS };

  if (entry.count + 1 > RATE_LIMIT_MAX) {
    rateLimit.set(key, entry);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1000)) };
  }

  entry.count += 1;
  rateLimit.set(key, entry);
  return { ok: true };
}

export function resetWaitlistRateLimitForTest(): void {
  rateLimit.clear();
}
