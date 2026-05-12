export const INVITE_EMAIL_LIMIT = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a free-form list of email addresses into a deduplicated array.
 *
 * Splits on commas, semicolons, and newlines (any combination, including
 * runs of separators), trims and lowercases each fragment, drops empty
 * fragments, and removes duplicates while preserving first-seen order.
 */
export function parseInviteEmails(text: string): string[] {
  const parts = text
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/** Returns true when `email` looks like a plausibly-deliverable address. */
export function isValidInviteEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim().toLowerCase());
}
