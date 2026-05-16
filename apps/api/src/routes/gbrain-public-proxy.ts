import { Readable } from 'node:stream';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';

import { db, schema } from '../db/client.js';
import {
  accessTokenExpiry,
  bearerToken,
  clientIdFromTokenRequest,
  hashMcpCredential,
  tokenFromRevokeRequest,
} from '../gbrain/mcp-public-auth.js';
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

export interface PublicGbrainProxyClient {
  id: string;
}

export interface PublicGbrainProxyAccessToken {
  id: string;
  clientId: string;
}

export interface PublicGbrainProxyRepo {
  findWorkspace(workspaceId: string): Promise<PublicGbrainProxyWorkspace | null>;
  findActiveClient(workspaceId: string, clientId: string): Promise<PublicGbrainProxyClient | null>;
  recordIssuedAccessToken(input: {
    workspaceId: string;
    clientId: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
  findActiveAccessToken(
    workspaceId: string,
    token: string,
  ): Promise<PublicGbrainProxyAccessToken | null>;
  markAccessTokenUsed(tokenId: string, clientId: string): Promise<void>;
  revokeAccessToken(workspaceId: string, token: string): Promise<void>;
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

      const baseUrl =
        workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.gbrainPrivateAddress!);
      if (req.path === '/token') {
        await proxyTokenRequest(req, res, { baseUrl, fetchImpl, repo, workspaceId });
        return;
      }

      if (req.path === '/mcp') {
        const token = bearerToken(req.header('authorization'));
        const activeToken = token ? await repo.findActiveAccessToken(workspaceId, token) : null;
        if (!activeToken) {
          json(res, 401, { error: 'invalid_token' });
          return;
        }
        await repo.markAccessTokenUsed(activeToken.id, activeToken.clientId);
      }

      if (req.path === '/revoke') {
        const body = await requestBody(req);
        const token = tokenFromRevokeRequest(body);
        if (token) {
          await repo.revokeAccessToken(workspaceId, token);
        }
        await proxyToGbrain(req, res, { baseUrl, fetchImpl, body });
        return;
      }

      await proxyToGbrain(req, res, {
        baseUrl,
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
    async findActiveClient(workspaceId, clientId) {
      const [row] = await db
        .select({ id: schema.workspaceMcpClients.id })
        .from(schema.workspaceMcpClients)
        .where(
          and(
            eq(schema.workspaceMcpClients.workspaceId, workspaceId),
            eq(schema.workspaceMcpClients.clientIdHash, hashMcpCredential(clientId)),
            isNull(schema.workspaceMcpClients.revokedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async recordIssuedAccessToken(input) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.workspaceMcpAccessTokens)
          .values({
            workspaceId: input.workspaceId,
            clientId: input.clientId,
            tokenHash: hashMcpCredential(input.token),
            expiresAt: input.expiresAt,
          })
          .onConflictDoUpdate({
            target: schema.workspaceMcpAccessTokens.tokenHash,
            set: {
              clientId: input.clientId,
              expiresAt: input.expiresAt,
              lastUsedAt: null,
              revokedAt: null,
            },
          });
        await tx
          .update(schema.workspaceMcpClients)
          .set({ lastUsedAt: now })
          .where(eq(schema.workspaceMcpClients.id, input.clientId));
      });
    },
    async findActiveAccessToken(workspaceId, token) {
      const [row] = await db
        .select({
          id: schema.workspaceMcpAccessTokens.id,
          clientId: schema.workspaceMcpAccessTokens.clientId,
        })
        .from(schema.workspaceMcpAccessTokens)
        .innerJoin(
          schema.workspaceMcpClients,
          eq(schema.workspaceMcpClients.id, schema.workspaceMcpAccessTokens.clientId),
        )
        .where(
          and(
            eq(schema.workspaceMcpAccessTokens.workspaceId, workspaceId),
            eq(schema.workspaceMcpAccessTokens.tokenHash, hashMcpCredential(token)),
            isNull(schema.workspaceMcpAccessTokens.revokedAt),
            isNull(schema.workspaceMcpClients.revokedAt),
            sql`${schema.workspaceMcpAccessTokens.expiresAt} > NOW()`,
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async markAccessTokenUsed(tokenId, clientId) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.workspaceMcpAccessTokens)
          .set({ lastUsedAt: now })
          .where(eq(schema.workspaceMcpAccessTokens.id, tokenId));
        await tx
          .update(schema.workspaceMcpClients)
          .set({ lastUsedAt: now })
          .where(eq(schema.workspaceMcpClients.id, clientId));
      });
    },
    async revokeAccessToken(workspaceId, token) {
      await db
        .update(schema.workspaceMcpAccessTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.workspaceMcpAccessTokens.workspaceId, workspaceId),
            eq(schema.workspaceMcpAccessTokens.tokenHash, hashMcpCredential(token)),
            isNull(schema.workspaceMcpAccessTokens.revokedAt),
          ),
        );
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
  options: { baseUrl: string; fetchImpl: Fetch; body?: Buffer },
): Promise<void> {
  const upstreamUrl = new URL(req.originalUrl, options.baseUrl.replace(/\/+$/, ''));
  const requestHeaders = upstreamRequestHeaders(req);
  const body = options.body ?? (await requestBody(req));
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

async function proxyTokenRequest(
  req: Request,
  res: Response,
  options: {
    baseUrl: string;
    fetchImpl: Fetch;
    repo: PublicGbrainProxyRepo;
    workspaceId: string;
  },
): Promise<void> {
  const body = await requestBody(req);
  const clientId = clientIdFromTokenRequest(body);
  const client = clientId
    ? await options.repo.findActiveClient(options.workspaceId, clientId)
    : null;
  if (!client) {
    json(res, 401, { error: 'invalid_client' });
    return;
  }

  const upstreamUrl = new URL(req.originalUrl, options.baseUrl.replace(/\/+$/, ''));
  const upstream = await options.fetchImpl(upstreamUrl, {
    method: req.method,
    headers: upstreamRequestHeaders(req),
    body,
  });
  const text = await upstream.text();
  if (upstream.ok) {
    const accessToken = parseAccessTokenPayload(text);
    if (accessToken) {
      await options.repo.recordIssuedAccessToken({
        workspaceId: options.workspaceId,
        clientId: client.id,
        token: accessToken.accessToken,
        expiresAt: accessTokenExpiry(accessToken.expiresIn),
      });
    }
  }
  sendTextResponse(res, upstream, text);
}

function parseAccessTokenPayload(text: string): { accessToken: string; expiresIn: unknown } | null {
  try {
    const payload = JSON.parse(text) as Partial<{ access_token: unknown; expires_in: unknown }>;
    return typeof payload.access_token === 'string'
      ? { accessToken: payload.access_token, expiresIn: payload.expires_in }
      : null;
  } catch {
    return null;
  }
}

function sendTextResponse(res: Response, upstream: globalThis.Response, text: string): void {
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Open42-Gbrain-Proxy', '1');
  res.send(text);
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

function json(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
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
