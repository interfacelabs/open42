import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_FROM = process.env.RESEND_FROM_ADDRESS ?? 'open42 <noreply@open42.app>';
const TOKEN_QUERY_KEYS = new Set([
  'access_token',
  'code',
  'invite_id',
  'key',
  'refresh_token',
  'secret',
  'session',
  'state',
  'token',
  'token_hash',
]);

let cachedClient: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    if (!allowStdoutFallback()) {
      console.warn(
        `[email-provider-unconfigured] to=${input.to} subject=${JSON.stringify(input.subject)}`,
      );
      return { ok: false, error: 'email_provider_not_configured' };
    }
    console.log(
      `[email-stdout-fallback] to=${input.to} subject=${JSON.stringify(input.subject)}\n${redactEmailBodyForLog(input.text)}`,
    );
    return { ok: true };
  }
  try {
    await client.emails.send({
      from: input.from ?? DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resend_unknown_error';
    return { ok: false, error: message };
  }
}

export function redactEmailBodyForLog(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"')]+/gi, (candidate) => {
    if (!isTokenBearingUrl(candidate)) return candidate;
    return '[redacted-url]';
  });
}

function allowStdoutFallback(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.OPEN42_EMAIL_STDOUT_FALLBACK === 'true'
  );
}

function isTokenBearingUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    for (const key of url.searchParams.keys()) {
      const normalized = key.toLowerCase();
      if (TOKEN_QUERY_KEYS.has(normalized) || normalized.includes('token')) {
        return true;
      }
    }
    return false;
  } catch {
    return /[?&][^=\s]*(token|secret|session|invite|code|state|key)[^=\s]*=/i.test(candidate);
  }
}
