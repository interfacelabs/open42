import { and, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response, type NextFunction } from 'express';

import { db, schema } from '../../db/client.js';
import { registerGbrainOAuthClientWithOptions } from '../../gbrain/client.js';
import { gbrainPublicProxyBaseUrl, type GbrainPublicProxyEnv } from '../../gbrain/public-proxy.js';

type Fetch = typeof fetch;

interface WorkspaceMcpProxyRow {
  id: string;
  status: string;
  gbrainBaseUrl: string | null;
  gbrainPrivateAddress: string | null;
  gbrainMcpProxyEnabled: boolean;
}

export interface WorkspaceMcpProxyRepo {
  findWorkspace(workspaceId: string): Promise<WorkspaceMcpProxyRow | null>;
  setEnabled(workspaceId: string, enabled: boolean): Promise<void>;
}

export interface WorkspaceMcpProxyDeps {
  env?: GbrainPublicProxyEnv;
  fetch?: Fetch;
  repo?: WorkspaceMcpProxyRepo;
}

export function buildWorkspaceMcpProxyRouter(deps: WorkspaceMcpProxyDeps = {}) {
  const router = Router({ mergeParams: true });
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const repo = deps.repo ?? createDrizzleWorkspaceMcpProxyRepo();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await findWorkspaceOr404(req, res, repo);
      if (!workspace) return;
      res.json(proxyPayload(workspace, env));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await findWorkspaceOr404(req, res, repo);
      if (!workspace) return;
      const enabled = Boolean(req.body?.enabled);
      const publicBaseUrl = gbrainPublicProxyBaseUrl(workspace.id, env);
      if (enabled && !publicBaseUrl) {
        res.status(503).json({ error: 'mcp_proxy_domain_not_configured' });
        return;
      }
      if (enabled && !isWorkspaceProxyReady(workspace)) {
        res.status(409).json({ error: 'workspace_gbrain_not_ready' });
        return;
      }

      await repo.setEnabled(workspace.id, enabled);
      res.json(proxyPayload({ ...workspace, gbrainMcpProxyEnabled: enabled }, env));
    } catch (err) {
      next(err);
    }
  });

  router.post('/clients', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await findWorkspaceOr404(req, res, repo);
      if (!workspace) return;
      if (!workspace.gbrainMcpProxyEnabled) {
        res.status(409).json({ error: 'mcp_proxy_disabled' });
        return;
      }
      if (!isWorkspaceProxyReady(workspace)) {
        res.status(409).json({ error: 'workspace_gbrain_not_ready' });
        return;
      }

      const publicBaseUrl = gbrainPublicProxyBaseUrl(workspace.id, env);
      if (!publicBaseUrl) {
        res.status(503).json({ error: 'mcp_proxy_domain_not_configured' });
        return;
      }

      const clientName = normalizeClientName(req.body?.name);
      if (!clientName) {
        res.status(400).json({ error: 'client_name_invalid' });
        return;
      }
      const scope = normalizeClientScope(req.body?.scope);
      if (!scope) {
        res.status(400).json({ error: 'client_scope_invalid' });
        return;
      }

      const client = await registerGbrainOAuthClientWithOptions(gbrainBaseUrl(workspace), {
        clientName,
        grantTypes: ['client_credentials'],
        redirectUris: [],
        scope,
        tokenEndpointAuthMethod: 'client_secret_post',
        fetchImpl,
      });

      res.status(201).json({
        clientId: client.client_id,
        clientSecret: client.client_secret,
        scope,
        grantType: 'client_credentials',
        issuerUrl: publicBaseUrl,
        tokenUrl: `${publicBaseUrl}/token`,
        mcpUrl: `${publicBaseUrl}/mcp`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function createDrizzleWorkspaceMcpProxyRepo(): WorkspaceMcpProxyRepo {
  return {
    async findWorkspace(workspaceId) {
      const [row] = await db
        .select({
          id: schema.workspaces.id,
          status: schema.workspaces.status,
          gbrainBaseUrl: schema.workspaces.gbrainBaseUrl,
          gbrainPrivateAddress: schema.workspaces.gbrainPrivateAddress,
          gbrainMcpProxyEnabled: schema.workspaces.gbrainMcpProxyEnabled,
        })
        .from(schema.workspaces)
        .where(and(eq(schema.workspaces.id, workspaceId), isNull(schema.workspaces.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    async setEnabled(workspaceId, enabled) {
      await db
        .update(schema.workspaces)
        .set({ gbrainMcpProxyEnabled: enabled })
        .where(eq(schema.workspaces.id, workspaceId));
    },
  };
}

async function findWorkspaceOr404(
  req: Request,
  res: Response,
  repo: WorkspaceMcpProxyRepo,
): Promise<WorkspaceMcpProxyRow | null> {
  const workspaceId = req.workspace?.id ?? req.params.id;
  const workspace = workspaceId ? await repo.findWorkspace(workspaceId) : null;
  if (!workspace) {
    res.status(404).json({ error: 'workspace_not_found' });
    return null;
  }
  return workspace;
}

function proxyPayload(workspace: WorkspaceMcpProxyRow, env: GbrainPublicProxyEnv) {
  const publicBaseUrl = gbrainPublicProxyBaseUrl(workspace.id, env);
  return {
    enabled: workspace.gbrainMcpProxyEnabled,
    available: Boolean(publicBaseUrl),
    issuerUrl: publicBaseUrl,
    mcpUrl: publicBaseUrl ? `${publicBaseUrl}/mcp` : null,
  };
}

function isWorkspaceProxyReady(workspace: WorkspaceMcpProxyRow): boolean {
  return (
    workspace.status === 'ready' &&
    Boolean(workspace.gbrainBaseUrl || workspace.gbrainPrivateAddress)
  );
}

function gbrainBaseUrl(workspace: WorkspaceMcpProxyRow): string {
  if (workspace.gbrainBaseUrl) return workspace.gbrainBaseUrl.replace(/\/+$/, '');
  const privateAddress = workspace.gbrainPrivateAddress!;
  if (/^https?:\/\//.test(privateAddress)) return privateAddress.replace(/\/+$/, '');
  if (privateAddress.startsWith('[') || privateAddress.split(':').length === 2) {
    return `http://${privateAddress}`;
  }
  if (privateAddress.includes(':')) {
    return `http://[${privateAddress}]:8080`;
  }
  return `http://${privateAddress}:8080`;
}

function normalizeClientName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 80) return null;
  return normalized;
}

function normalizeClientScope(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return 'read';
  if (typeof value !== 'string') return null;
  const scopes = Array.from(new Set(value.trim().split(/\s+/).filter(Boolean)));
  if (!scopes.length) return 'read';
  if (scopes.some((scope) => scope !== 'read' && scope !== 'write')) return null;
  if (!scopes.includes('read')) return null;
  return scopes.join(' ');
}
