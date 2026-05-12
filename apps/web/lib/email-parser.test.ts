import { describe, it, expect } from 'vitest';

import { isValidInviteEmail, parseInviteEmails } from './email-parser';

describe('parseInviteEmails', () => {
  it('splits on commas, semicolons, newlines', () => {
    expect(parseInviteEmails('a@b.com,c@d.com;e@f.com\ng@h.com')).toEqual([
      'a@b.com',
      'c@d.com',
      'e@f.com',
      'g@h.com',
    ]);
  });

  it('lowercases and trims', () => {
    expect(parseInviteEmails(' A@B.com , C@D.com ')).toEqual(['a@b.com', 'c@d.com']);
  });

  it('deduplicates while preserving first-seen order', () => {
    expect(parseInviteEmails('a@b.com, a@b.com')).toEqual(['a@b.com']);
    expect(parseInviteEmails('b@b.com, a@a.com, b@b.com')).toEqual([
      'b@b.com',
      'a@a.com',
    ]);
  });

  it('drops empty fragments produced by stray separators', () => {
    expect(parseInviteEmails(',a@b.com,,,b@c.com,')).toEqual(['a@b.com', 'b@c.com']);
    expect(parseInviteEmails('\n\n')).toEqual([]);
    expect(parseInviteEmails('')).toEqual([]);
  });
});

describe('isValidInviteEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidInviteEmail('a@b.co')).toBe(true);
    expect(isValidInviteEmail('first.last+tag@example.com')).toBe(true);
    expect(isValidInviteEmail('  A@B.co  ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidInviteEmail('not-an-email')).toBe(false);
    expect(isValidInviteEmail('a@b')).toBe(false);
    expect(isValidInviteEmail('a@')).toBe(false);
    expect(isValidInviteEmail('@b.co')).toBe(false);
    expect(isValidInviteEmail('a b@c.co')).toBe(false);
    expect(isValidInviteEmail('')).toBe(false);
  });
});
