import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NOTIFY_EMAIL = process.env.OPEN42_WAITLIST_NOTIFY_EMAIL ?? 'riccardo@interfacelabs.ai';
const FROM_EMAIL = process.env.RESEND_FROM_ADDRESS ?? 'Open42 <noreply@mail.open42.ai>';
const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type WaitlistBody = {
  email?: unknown;
  source?: unknown;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(getClientKey(request));
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: WaitlistBody;
  try {
    body = (await request.json()) as WaitlistBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: 'email_invalid' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[waitlist-email-unconfigured] RESEND_API_KEY is not set');
    return NextResponse.json({ error: 'email_provider_not_configured' }, { status: 503 });
  }

  const source = normalizeSource(body.source);
  const submittedAt = new Date().toISOString();
  const result = await sendWaitlistNotification({ apiKey, email, source, submittedAt });

  if (!result.ok) {
    console.warn(`[waitlist-email-failed] ${result.error}`);
    return NextResponse.json({ error: 'email_send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function normalizeSource(value: unknown): string {
  if (typeof value !== 'string') return 'landing';
  const source = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return source.slice(0, 40) || 'landing';
}

function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function checkRateLimit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    pruneExpiredBuckets(now);
    return { ok: true };
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  existing.count += 1;
  return { ok: true };
}

function pruneExpiredBuckets(now: number): void {
  if (rateLimitBuckets.size < 500) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

async function sendWaitlistNotification(input: {
  apiKey: string;
  email: string;
  source: string;
  submittedAt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = [
    'New Open42 beta access request.',
    '',
    `Email: ${input.email}`,
    `Source: ${input.source}`,
    `Submitted: ${input.submittedAt}`,
  ].join('\n');
  const html = [
    '<p>New Open42 beta access request.</p>',
    '<dl>',
    `<dt>Email</dt><dd><a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a></dd>`,
    `<dt>Source</dt><dd>${escapeHtml(input.source)}</dd>`,
    `<dt>Submitted</dt><dd>${escapeHtml(input.submittedAt)}</dd>`,
    '</dl>',
  ].join('');

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        reply_to: input.email,
        subject: `Open42 beta request: ${input.email}`,
        html,
        text,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `resend_${response.status}` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resend_unknown_error';
    return { ok: false, error: message };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
