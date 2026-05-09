import {
  buildProviderProxy,
  type ProviderProxyDeps,
  type ProviderProxyRoute,
} from './shared.js';

const OPENAI_ALLOWED_ROUTES: ProviderProxyRoute[] = [
  { method: 'POST', path: '/v1/embeddings', scope: 'embed' },
  { method: 'POST', path: '/v1/chat/completions', scope: 'chat' },
  // /v1/models has no body; we treat it as 'chat' scope for resolver lookup
  // because there's no separate "models" scope. Any non-null key works here.
  { method: 'GET', path: '/v1/models', scope: 'chat' },
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
