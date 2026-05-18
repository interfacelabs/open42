import { Readable } from 'node:stream';

import { and, eq, sql } from 'drizzle-orm';
import { Router, type Request, type Response as ExpressResponse } from 'express';

import { db, schema } from '../../db/client.js';
import { resolveGitHubAppClientForWorkspace } from '../../github/app-config.js';
import { hashGitProxyToken } from '../../github/bridge.js';
import { GitHubAppClient, GitHubAuthRequiredError } from '../../github/client.js';
import { markGitHubInstallationAuthRequired } from '../connections/github.js';

export interface GitHubGitProxyDeps {
  github?: GitHubAppClient;
}

export function buildGitHubGitProxyRouter(deps: GitHubGitProxyDeps = {}): Router {
  const router = Router();

  router.get(
    '/github/:token/:owner/:repo.git/info/refs',
    async (req: Request, res: ExpressResponse) => {
      if (req.query.service !== 'git-upload-pack') {
        res.status(403).end();
        return;
      }
      await proxyGitHubGitRequest(deps, req, res, 'info/refs');
    },
  );

  router.post(
    '/github/:token/:owner/:repo.git/git-upload-pack',
    async (req: Request, res: ExpressResponse) => {
      await proxyGitHubGitRequest(deps, req, res, 'git-upload-pack');
    },
  );

  return router;
}

async function proxyGitHubGitRequest(
  deps: GitHubGitProxyDeps,
  req: Request,
  res: ExpressResponse,
  suffix: 'info/refs' | 'git-upload-pack',
): Promise<void> {
  const token = param(req, 'token');
  const owner = normalizeOwnerRepo(param(req, 'owner'));
  const repo = normalizeOwnerRepo(param(req, 'repo'));
  if (!token || !owner || !repo) {
    res.status(404).end();
    return;
  }

  const source = await loadSourceForProxyToken(token, owner, repo);
  if (!source) {
    res.status(404).end();
    return;
  }

  try {
    const github = await resolveGitHubAppClientForWorkspace(source.workspaceId, deps.github);
    if (!github?.isConfigured()) {
      res.status(503).end();
      return;
    }
    const installationToken = await github.createInstallationToken(source.installationId);
    const upstream = await fetch(githubGitUrl(owner, repo, suffix), {
      method: req.method,
      headers: githubGitHeaders(req, installationToken),
      ...(req.method === 'POST' ? { body: req, duplex: 'half' as const } : {}),
    } as RequestInit & { duplex?: 'half' });

    await db
      .update(schema.githubRepoConnections)
      .set({ gitProxyLastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.githubRepoConnections.connectionId, source.connectionId))
      .catch(() => undefined);

    writeUpstreamResponse(upstream, res);
  } catch (err) {
    if (err instanceof GitHubAuthRequiredError) {
      await markGitHubInstallationAuthRequired(source.installationId).catch(() => undefined);
      res.status(401).end();
      return;
    }
    res.status(502).end();
  }
}

async function loadSourceForProxyToken(token: string, owner: string, repo: string) {
  const [row] = await db
    .select({
      workspaceId: schema.githubRepoConnections.workspaceId,
      connectionId: schema.githubRepoConnections.connectionId,
      installationId: schema.githubRepoConnections.installationId,
    })
    .from(schema.githubRepoConnections)
    .innerJoin(schema.connections, eq(schema.connections.id, schema.githubRepoConnections.connectionId))
    .where(
      and(
        eq(schema.githubRepoConnections.gitProxyTokenHash, hashGitProxyToken(token)),
        eq(schema.githubRepoConnections.syncTransport, 'open42-git-proxy'),
        eq(schema.githubRepoConnections.owner, owner),
        eq(schema.githubRepoConnections.repo, repo),
        sql`${schema.githubRepoConnections.repoPrivate} = true`,
        sql`${schema.connections.deletedAt} IS NULL`,
        sql`${schema.connections.status} <> 'disconnected'`,
      ),
    )
    .limit(1);
  return row ?? null;
}

function githubGitUrl(
  owner: string,
  repo: string,
  suffix: 'info/refs' | 'git-upload-pack',
): string {
  const url = new URL(`https://github.com/${owner}/${repo}.git/${suffix}`);
  if (suffix === 'info/refs') url.searchParams.set('service', 'git-upload-pack');
  return url.toString();
}

function githubGitHeaders(req: Request, installationToken: string): Headers {
  const headers = new Headers();
  headers.set(
    'Authorization',
    `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString('base64')}`,
  );
  headers.set('User-Agent', 'open42-git-proxy');
  const accept = req.header('accept');
  if (accept) headers.set('Accept', accept);
  const contentType = req.header('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  return headers;
}

function writeUpstreamResponse(upstream: globalThis.Response, res: ExpressResponse): void {
  res.status(upstream.status);
  for (const [name, value] of upstream.headers.entries()) {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  }
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as unknown as ReadableStream).pipe(res);
}

const SAFE_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-type',
  'expires',
  'pragma',
]);

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOwnerRepo(value: string): string | null {
  if (!value || value.length > 100) return null;
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
}
