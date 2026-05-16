const UUID_HEX_PATTERN = /^[0-9a-f]{32}$/;

export interface GbrainPublicProxyEnv {
  OPEN42_GBRAIN_PROXY_DOMAIN?: string;
  OPEN42_GBRAIN_PROXY_PROTOCOL?: string;
}

export function gbrainPublicProxySlug(workspaceId: string): string {
  const hex = workspaceId.toLowerCase().replace(/-/g, '');
  if (!UUID_HEX_PATTERN.test(hex)) {
    throw new Error('workspaceId must be a UUID');
  }
  return `ws-${hex}`;
}

export function workspaceIdFromGbrainPublicProxySlug(slug: string): string | null {
  const match = /^ws-([0-9a-f]{32})$/.exec(slug.toLowerCase());
  if (!match) return null;
  const hex = match[1]!;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function gbrainPublicProxyBaseUrl(
  workspaceId: string,
  env: GbrainPublicProxyEnv = process.env,
): string | null {
  const domain = (env.OPEN42_GBRAIN_PROXY_DOMAIN ?? '').trim().replace(/^\*\./, '');
  if (!domain) return null;
  const protocol = (env.OPEN42_GBRAIN_PROXY_PROTOCOL ?? 'https').replace(/:$/, '');
  return `${protocol}://${gbrainPublicProxySlug(workspaceId)}.${domain}`;
}
