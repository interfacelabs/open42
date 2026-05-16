import { Readable } from 'node:stream';

import { and, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';

import { db, schema } from '../db/client.js';
import {
  workspaceIdFromGbrainPublicProxySlug,
  type GbrainPublicProxyEnv,
} from '../gbrain/public-proxy.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  // Undici transparently decompresses response bodies. Forwarding the original
  // upstream encoding metadata would make clients try to decompress twice.
  'content-encoding',
]);

const ALLOWED_GBRAIN_PROXY_PATHS = new Set([
  '/mcp',
  '/health',
  '/token',
  '/authorize',
  '/revoke',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/openid-configuration',
]);

type Fetch = typeof fetch;

export interface PublicGbrainProxyWorkspace {
  id: string;
  gbrainBaseUrl: string | null;
  gbrainPrivateAddress: string | null;
  gbrainMcpProxyEnabled: boolean;
  status: string;
}

export interface PublicGbrainProxyRepo {
  findWorkspace(workspaceId: string): Promise<PublicGbrainProxyWorkspace | null>;
}

export interface PublicGbrainProxyDeps {
  env?: GbrainPublicProxyEnv;
  fetch?: Fetch;
  repo?: PublicGbrainProxyRepo;
}

export function buildPublicGbrainProxyRouter(deps: PublicGbrainProxyDeps = {}) {
  const router = Router();
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const repo = deps.repo ?? createDrizzlePublicGbrainProxyRepo();

  router.use(async (req, res, next) => {
    try {
      const workspaceId = workspaceIdFromProxyHost(req, env);
      if (!workspaceId) {
        next();
        return;
      }

      if (!ALLOWED_GBRAIN_PROXY_PATHS.has(req.path)) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const workspace = await repo.findWorkspace(workspaceId);
      if (
        !workspace ||
        !workspace.gbrainMcpProxyEnabled ||
        workspace.status !== 'ready' ||
        !(workspace.gbrainBaseUrl || workspace.gbrainPrivateAddress)
      ) {
        res.status(404).json({ error: 'mcp_proxy_not_found' });
        return;
      }

      await proxyToGbrain(req, res, {
        baseUrl: workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.gbrainPrivateAddress!),
        fetchImpl,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function createDrizzlePublicGbrainProxyRepo(): PublicGbrainProxyRepo {
  return {
    async findWorkspace(workspaceId) {
      const [row] = await db
        .select({
          id: schema.workspaces.id,
          gbrainBaseUrl: schema.workspaces.gbrainBaseUrl,
          gbrainPrivateAddress: schema.workspaces.gbrainPrivateAddress,
          gbrainMcpProxyEnabled: schema.workspaces.gbrainMcpProxyEnabled,
          status: schema.workspaces.status,
        })
        .from(schema.workspaces)
        .where(and(eq(schema.workspaces.id, workspaceId), isNull(schema.workspaces.deletedAt)))
        .limit(1);
      return row ?? null;
    },
  };
}

function workspaceIdFromProxyHost(req: Request, env: GbrainPublicProxyEnv): string | null {
  const domain = (env.OPEN42_GBRAIN_PROXY_DOMAIN ?? '').trim().replace(/^\*\./, '').toLowerCase();
  if (!domain) return null;
  const hostname = req.hostname.toLowerCase();
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!slug || slug.includes('.')) return null;
  return workspaceIdFromGbrainPublicProxySlug(slug);
}

async function proxyToGbrain(
  req: Request,
  res: Response,
  options: { baseUrl: string; fetchImpl: Fetch },
): Promise<void> {
  const upstreamUrl = new URL(req.originalUrl, options.baseUrl.replace(/\/+$/, ''));
  const requestHeaders = upstreamRequestHeaders(req);
  const body = await requestBody(req);
  const upstream = await options.fetchImpl(upstreamUrl, {
    method: req.method,
    headers: requestHeaders,
    body,
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Open42-Gbrain-Proxy', '1');

  if (!upstream.body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(upstream.body as never)
      .on('error', reject)
      .on('end', resolve)
      .pipe(res);
  });
}

function upstreamRequestHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, rawValue] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'host' || lower === 'accept-encoding') {
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(key, value);
    } else if (rawValue !== undefined) {
      headers.set(key, rawValue);
    }
  }
  headers.set('x-forwarded-host', req.hostname);
  headers.set('x-forwarded-proto', req.protocol);
  return headers;
}

function requestBody(req: Request): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
  });
}

function formatGbrainBaseUrl(privateAddress: string): string {
  if (/^https?:\/\//.test(privateAddress)) return privateAddress.replace(/\/+$/, '');
  if (privateAddress.startsWith('[') || privateAddress.split(':').length === 2) {
    return `http://${privateAddress}`;
  }
  if (privateAddress.includes(':')) {
    return `http://[${privateAddress}]:8080`;
  }
  return `http://${privateAddress}:8080`;
}
