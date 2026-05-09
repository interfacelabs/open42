import { buildProviderProxy, type ProviderProxyDeps } from './shared.js';

const OPENAI_ALLOWED_PATHS = ['/v1/embeddings', '/v1/chat/completions', '/v1/models'];

export function buildOpenAIProxy(deps: ProviderProxyDeps = {}) {
  return buildProviderProxy(
    {
      name: 'openai',
      allowedPaths: OPENAI_ALLOWED_PATHS,
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
