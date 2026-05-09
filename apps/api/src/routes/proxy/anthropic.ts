import { buildProviderProxy, type ProviderProxyDeps } from './shared.js';

const ANTHROPIC_ALLOWED_PATHS = ['/v1/messages', '/v1/messages/count_tokens'];

export function buildAnthropicProxy(deps: ProviderProxyDeps = {}) {
  return buildProviderProxy(
    {
      name: 'anthropic',
      allowedPaths: ANTHROPIC_ALLOWED_PATHS,
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
