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
    console.log(
      `[email-stdout-fallback] to=${input.to} subject=${JSON.stringify(input.subject)}\n${input.text}`,
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
