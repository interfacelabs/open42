import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail } from './resend.js';

describe('sendEmail', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalEnv;
  });

  it('logs to stdout and returns ok when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[email-stdout-fallback]'));
    spy.mockRestore();
  });
});
