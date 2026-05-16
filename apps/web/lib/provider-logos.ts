/**
 * Hardcoded provider logo map.
 *
 * Composio hosts public logos at `https://logos.composio.dev/api/<slug>`.
 * We map our internal connection kinds (e.g. `notion-composio`, `notion-zip`)
 * to a Composio toolkit slug so both the live connections list and the
 * onboarding/add catalogs render the same icon.
 *
 * When we wire up a new provider, add it here. When we move past hardcoding
 * (live `/api/v3/toolkits` proxy with caching), this module becomes the
 * fallback for offline / preview.
 */

const LOGO_BASE = 'https://logos.composio.dev/api';

export const PROVIDER_LOGOS: Record<string, string> = {
  notion: `${LOGO_BASE}/notion`,
  googledocs: `${LOGO_BASE}/googledocs`,
  googledrive: `${LOGO_BASE}/googledrive`,
  slack: `${LOGO_BASE}/slack`,
  gmail: `${LOGO_BASE}/gmail`,
  confluence: `${LOGO_BASE}/confluence`,
  linear: `${LOGO_BASE}/linear`,
  github: `${LOGO_BASE}/github`,
  dropbox: `${LOGO_BASE}/dropbox`,
  box: `${LOGO_BASE}/box`,
};

export function providerLogo(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return PROVIDER_LOGOS[slug] ?? null;
}

/**
 * Map a connection `kind` from the API (e.g. `notion-composio`, `notion-zip`)
 * to the toolkit slug used for logo lookup. Returns null for kinds without
 * a clean provider mapping (e.g. raw markdown uploads in the future).
 */
export function connectionKindToSlug(kind: string): string | null {
  if (kind.startsWith('notion-')) return 'notion';
  // Future Composio kinds expected to follow `<provider>-composio` pattern.
  const [provider] = kind.split('-');
  return provider && provider in PROVIDER_LOGOS ? provider : null;
}
