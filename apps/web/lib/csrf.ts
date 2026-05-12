/**
 * Reads the open42_csrf cookie and returns headers for mutating requests.
 *
 * Returns an empty object if the cookie is absent (the server will reject
 * the request and the client will show an auth error) or if called outside
 * a browser (SSR / tests without jsdom).
 *
 * Header name is the canonical `X-CSRF-Token`; the server middleware reads it
 * case-insensitively (`x-csrf-token`) so either works on the wire, but we
 * normalize on the canonical form for grep-ability.
 */
export function csrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(/(?:^|; )open42_csrf=([^;]+)/);
  return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]!) } : {};
}
