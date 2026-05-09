import { describe, expect, it } from 'vitest';

import { PINO_ERROR_REDACT_PATHS, sanitizeErrorForLog } from './error-sanitize.js';

const SECRET = 'SECRET CUSTOMER PII';

describe('sanitizeErrorForLog', () => {
  it('strips .details payload that may carry echoed tool args', () => {
    const err = new Error('gbrain query failed');
    Object.assign(err, {
      details: { tool_name: 'query', args: { query: SECRET } },
    });

    const sanitized = sanitizeErrorForLog(err);
    expect(JSON.stringify(sanitized)).not.toContain(SECRET);
    expect((sanitized as unknown as Record<string, unknown>).details).toBeUndefined();
    expect(sanitized.name).toBe('Error');
    expect(sanitized.message).toBe('gbrain query failed');
  });

  it('strips chained .cause that carries the same details', () => {
    const root = new Error('upstream blew up');
    Object.assign(root, {
      details: { tool_name: 'query', args: { query: SECRET } },
    });
    const wrapper = new Error('wrapping error');
    (wrapper as { cause?: unknown }).cause = root;
    Object.assign(wrapper, { details: { args: { query: SECRET } } });

    const sanitized = sanitizeErrorForLog(wrapper);
    expect(JSON.stringify(sanitized)).not.toContain(SECRET);
    expect((sanitized as unknown as Record<string, unknown>).cause).toBeUndefined();
    expect((sanitized as unknown as Record<string, unknown>).details).toBeUndefined();
  });

  it('keeps name, status, code, and bodyLength but drops body', () => {
    const err = new Error('gbrain HTTP 502');
    err.name = 'GbrainHttpError';
    Object.assign(err, {
      status: 502,
      code: -32000,
      bodyLength: 4096,
      body: SECRET,
      details: SECRET,
    });

    const sanitized = sanitizeErrorForLog(err);
    expect(sanitized).toEqual({
      name: 'GbrainHttpError',
      message: 'gbrain HTTP 502',
      status: 502,
      code: -32000,
      bodyLength: 4096,
    });
    expect(JSON.stringify(sanitized)).not.toContain(SECRET);
  });

  it('truncates very long messages to cap at 500 chars (+ marker)', () => {
    const long = `prefix ${'A'.repeat(2000)} ${SECRET} suffix`;
    const sanitized = sanitizeErrorForLog(new Error(long));
    // Truncation prevents arbitrary upstream content from leaking via message.
    expect(sanitized.message.length).toBeLessThanOrEqual(600);
    expect(sanitized.message.startsWith('prefix ')).toBe(true);
    expect(sanitized.message).toContain('truncated');
    // The secret appended after 2000 A's must NOT survive the truncation cap.
    expect(sanitized.message).not.toContain(SECRET);
  });

  it('handles non-Error values without throwing', () => {
    expect(sanitizeErrorForLog(undefined)).toEqual({ name: 'NonError', message: '' });
    expect(sanitizeErrorForLog(null)).toEqual({ name: 'NonError', message: '' });
    expect(sanitizeErrorForLog('plain string')).toEqual({ name: 'NonError', message: 'plain string' });
    expect(sanitizeErrorForLog({ message: 'literal', status: 404 })).toEqual({
      name: 'NonError',
      message: 'literal',
      status: 404,
    });
  });

  it('redact path list covers the dangerous fields', () => {
    expect(PINO_ERROR_REDACT_PATHS).toContain('err.details');
    expect(PINO_ERROR_REDACT_PATHS).toContain('err.body');
    expect(PINO_ERROR_REDACT_PATHS).toContain('err.cause');
    expect(PINO_ERROR_REDACT_PATHS).toContain('err.response');
    expect(PINO_ERROR_REDACT_PATHS).toContain('req.body');
    expect(PINO_ERROR_REDACT_PATHS).toContain('res.body');
  });
});
