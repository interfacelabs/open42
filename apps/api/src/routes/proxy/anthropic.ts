import {
  buildProviderProxy,
  type ProviderProxyDeps,
  type ProviderProxyRoute,
} from './shared.js';

const ANTHROPIC_ALLOWED_ROUTES: ProviderProxyRoute[] = [
  { method: 'POST', path: '/v1/messages' },
  { method: 'POST', path: '/v1/messages/count_tokens' },
];

export function buildAnthropicProxy(deps: ProviderProxyDeps = {}) {
  return buildProviderProxy(
    {
      name: 'anthropic',
      allowedRoutes: ANTHROPIC_ALLOWED_ROUTES,
      apiKeyEnvName: 'ANTHROPIC_API_KEY',
      upstreamUrl: (path, query) => `https://api.anthropic.com${path}${query}`,
      upstreamAuthHeaders: (apiKey) => ({
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }),
    },
    deps,
  );
}
