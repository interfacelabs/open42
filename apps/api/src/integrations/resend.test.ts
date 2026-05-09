import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redactEmailBodyForLog, sendEmail } from './resend.js';

describe('sendEmail', () => {
  let originalApiKey: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalFallback: string | undefined;
  beforeEach(() => {
    originalApiKey = process.env.RESEND_API_KEY;
    originalNodeEnv = process.env.NODE_ENV;
    originalFallback = process.env.OPEN42_EMAIL_STDOUT_FALLBACK;
    delete process.env.OPEN42_EMAIL_STDOUT_FALLBACK;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFallback === undefined) delete process.env.OPEN42_EMAIL_STDOUT_FALLBACK;
    else process.env.OPEN42_EMAIL_STDOUT_FALLBACK = originalFallback;
  });

  it('fails closed when RESEND_API_KEY is unset and stdout fallback is not explicitly enabled', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'development';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result).toEqual({ ok: false, error: 'email_provider_not_configured' });
    expect(spy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[email-provider-unconfigured]'));
  });

  it('keeps production fail-closed even when the stdout fallback flag is set', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'production';
    process.env.OPEN42_EMAIL_STDOUT_FALLBACK = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'https://open42.test/auth/invite/accept?invite_id=abc&token_hash=secret',
    });
    expect(result).toEqual({ ok: false, error: 'email_provider_not_configured' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('redacts token-bearing URLs in the opt-in stdout fallback', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'development';
    process.env.OPEN42_EMAIL_STDOUT_FALLBACK = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'Accept: https://open42.test/auth/invite/accept?invite_id=abc&token_hash=secret',
    });
    expect(result).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[redacted-url]'));
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('token_hash=secret'));
  });
});

describe('redactEmailBodyForLog', () => {
  it('leaves ordinary links alone and redacts token-bearing links', () => {
    expect(
      redactEmailBodyForLog(
        'Read https://open42.test/docs then accept https://open42.test/auth?token_hash=secret',
      ),
    ).toBe('Read https://open42.test/docs then accept [redacted-url]');
  });
});
