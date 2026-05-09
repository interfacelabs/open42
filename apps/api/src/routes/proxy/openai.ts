import {
  buildProviderProxy,
  type ProviderProxyDeps,
  type ProviderProxyRoute,
} from './shared.js';

const OPENAI_ALLOWED_ROUTES: ProviderProxyRoute[] = [
  { method: 'POST', path: '/v1/embeddings' },
  { method: 'POST', path: '/v1/chat/completions' },
  { method: 'GET', path: '/v1/models' },
];

export function buildOpenAIProxy(deps: ProviderProxyDeps = {}) {
  return buildProviderProxy(
    {
      name: 'openai',
      allowedRoutes: OPENAI_ALLOWED_ROUTES,
      apiKeyEnvName: 'OPENAI_API_KEY',
      upstreamUrl: (path, query) => `https://api.openai.com/v1${stripV1Prefix(path)}${query}`,
      upstreamAuthHeaders: (apiKey) => ({
        Authorization: `Bearer ${apiKey}`,
      }),
    },
    deps,
  );
}

function stripV1Prefix(path: string): string {
  return path.startsWith('/v1/') ? path.slice('/v1'.length) : path;
}
