import { Readable } from 'node:stream';

import express, { Router, type Request, type Response as ExpressResponse } from 'express';
import pino from 'pino';

import { verifyProxyToken as defaultVerifyProxyToken } from '../../proxy/token.js';

const RAW_BODY_LIMIT = '8mb';
const FAILED_AUTH_LIMIT = 30;
const FAILED_AUTH_WINDOW_MS = 5 * 60 * 1000;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
]);
const REQUEST_PASSTHROUGH_HEADERS = ['content-type', 'accept', 'user-agent'];

type Fetch = typeof fetch;
type VerifyProxyToken = typeof defaultVerifyProxyToken;

export interface ProviderProxyConfig {
  name: 'openai' | 'anthropic';
  allowedPaths: string[];
  apiKeyEnvName: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY';
  upstreamUrl: (path: string, query: string) => string;
  upstreamAuthHeaders: (apiKey: string) => Record<string, string>;
}

export interface ProviderProxyDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  logger?: Pick<pino.Logger, 'info' | 'error'>;
  now?: () => number;
  verifyProxyToken?: VerifyProxyToken;
}

export function buildProviderProxy(
  config: ProviderProxyConfig,
  deps: ProviderProxyDeps = {},
): Router {
  const router = Router();
  const fetchImpl = deps.fetch ?? fetch;
  const verifyProxyToken = deps.verifyProxyToken ?? defaultVerifyProxyToken;
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const logger =
    deps.logger ??
    pino({ name: `proxy/${config.name}`, level: process.env.LOG_LEVEL ?? 'info' });
  const failedAuth = new Map<string, { count: number; resetAt: number }>();

  router.use(express.raw({ type: '*/*', limit: RAW_BODY_LIMIT }));

  const handler = async (req: Request, res: ExpressResponse): Promise<void> => {
    const startedAt = now();
    const ip = requestIp(req);
    const limited = retryAfterIfLimited(failedAuth, ip, now());
    if (limited !== null) {
      res.setHeader('Retry-After', String(limited));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const auth = await authenticateProxyTokens(proxyTokensFromRequest(req), verifyProxyToken);
    if (!auth) {
      const retryAfter = recordFailedAuth(failedAuth, ip, now());
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    failedAuth.delete(ip);

    // TODO: Prefer a tenant BYOK secret when one is configured for this workspace.
    const upstreamApiKey = env[config.apiKeyEnvName]?.trim();
    if (!upstreamApiKey) {
      res.status(503).json({ error: 'upstream_key_unconfigured' });
      return;
    }

    const upstreamHeaders = buildUpstreamHeaders(req, config, upstreamApiKey);
    const body = requestBody(req);
    let upstream: globalThis.Response;
    try {
      upstream = await fetchImpl(config.upstreamUrl(req.path, requestQuery(req)), {
        method: req.method,
        headers: upstreamHeaders,
        body,
      });
    } catch (err) {
      logger.error({ err, workspaceId: auth.workspaceId, route: req.path }, 'proxy_fetch_failed');
      res.status(502).json({ error: 'upstream_unavailable' });
      return;
    }

    res.status(upstream.status);
    copyResponseHeaders(upstream.headers, res);
    logOnResponseClose(logger, {
      workspaceId: auth.workspaceId,
      route: req.path,
      status: upstream.status,
      startedAt,
      now,
      res,
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(
      upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
    stream.on('error', (err) => {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    stream.pipe(res);
  };

  for (const path of config.allowedPaths) {
    router.all(path, handler);
  }

  router.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return router;
}

function buildUpstreamHeaders(
  req: Request,
  config: ProviderProxyConfig,
  upstreamApiKey: string,
): Headers {
  const headers = new Headers();
  for (const name of REQUEST_PASSTHROUGH_HEADERS) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(config.upstreamAuthHeaders(upstreamApiKey))) {
    headers.set(name, value);
  }
  return headers;
}

function copyResponseHeaders(headers: Headers, res: ExpressResponse): void {
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'content-length' || lower === 'content-encoding') continue;
    if (
      lower === 'content-type' ||
      lower === 'cache-control' ||
      lower === 'retry-after' ||
      isRateLimitHeader(lower)
    ) {
      res.setHeader(name, value);
    }
  }
}

async function authenticateProxyTokens(
  tokens: string[],
  verifyProxyToken: VerifyProxyToken,
): ReturnType<VerifyProxyToken> {
  for (const token of tokens) {
    const auth = await verifyProxyToken(token);
    if (auth) return auth;
  }
  return null;
}

function proxyTokensFromRequest(req: Request): string[] {
  const tokens: string[] = [];
  const authorization = req.header('authorization')?.trim();
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice('bearer '.length).trim();
    if (token) tokens.push(token);
  }
  const apiKey = req.header('x-api-key')?.trim();
  if (apiKey) tokens.push(apiKey);
  return tokens;
}

function requestBody(req: Request): Buffer | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return undefined;
  return req.body;
}

function requestQuery(req: Request): string {
  const queryStart = req.url.indexOf('?');
  return queryStart === -1 ? '' : req.url.slice(queryStart);
}

function requestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function retryAfterIfLimited(
  failedAuth: Map<string, { count: number; resetAt: number }>,
  ip: string,
  now: number,
): number | null {
  const entry = failedAuth.get(ip);
  if (!entry) return null;
  if (entry.resetAt <= now) {
    failedAuth.delete(ip);
    return null;
  }
  if (entry.count < FAILED_AUTH_LIMIT) return null;
  return secondsUntil(entry.resetAt, now);
}

function recordFailedAuth(
  failedAuth: Map<string, { count: number; resetAt: number }>,
  ip: string,
  now: number,
): number | null {
  const existing = failedAuth.get(ip);
  const entry =
    existing && existing.resetAt > now
      ? { count: existing.count + 1, resetAt: existing.resetAt }
      : { count: 1, resetAt: now + FAILED_AUTH_WINDOW_MS };
  failedAuth.set(ip, entry);
  return entry.count > FAILED_AUTH_LIMIT ? secondsUntil(entry.resetAt, now) : null;
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function isRateLimitHeader(name: string): boolean {
  return name.includes('ratelimit') || name.startsWith('rate-limit');
}

function logOnResponseClose(
  logger: Pick<pino.Logger, 'info'>,
  input: {
    workspaceId: string;
    route: string;
    status: number;
    startedAt: number;
    now: () => number;
    res: ExpressResponse;
  },
): void {
  let logged = false;
  const log = () => {
    if (logged) return;
    logged = true;
    logger.info({
      workspaceId: input.workspaceId,
      route: input.route,
      status: input.status,
      durationMs: input.now() - input.startedAt,
    });
  };
  input.res.once('finish', log);
  input.res.once('close', log);
}
