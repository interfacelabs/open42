import { and, desc, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response, type NextFunction } from 'express';

import { db, schema } from '../../db/client.js';
import { registerGbrainOAuthClientWithOptions } from '../../gbrain/client.js';
import { hashMcpCredential } from '../../gbrain/mcp-public-auth.js';
import { gbrainPublicProxyBaseUrl, type GbrainPublicProxyEnv } from '../../gbrain/public-proxy.js';

type Fetch = typeof fetch;

interface WorkspaceMcpProxyRow {
  id: string;
  status: string;
  gbrainBaseUrl: string | null;
  gbrainPrivateAddress: string | null;
  gbrainMcpProxyEnabled: boolean;
}

interface WorkspaceMcpClientRow {
  id: string;
  label: string;
  scopes: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface WorkspaceMcpProxyRepo {
  findWorkspace(workspaceId: string): Promise<WorkspaceMcpProxyRow | null>;
  setEnabled(workspaceId: string, enabled: boolean): Promise<void>;
  listClients(workspaceId: string): Promise<WorkspaceMcpClientRow[]>;
  createClient(input: {
    workspaceId: string;
    createdByUserId: string;
    label: string;
    clientId: string;
    scopes: string;
  }): Promise<WorkspaceMcpClientRow>;
  revokeClient(workspaceId: string, clientId: string): Promise<boolean>;
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
      res.json({
        ...proxyPayload(workspace, env),
        clients: (await repo.listClients(workspace.id)).map(clientPayload),
      });
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
      res.json({
        ...proxyPayload({ ...workspace, gbrainMcpProxyEnabled: enabled }, env),
        clients: (await repo.listClients(workspace.id)).map(clientPayload),
      });
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
      const storedClient = await repo.createClient({
        workspaceId: workspace.id,
        createdByUserId: req.session!.userId,
        label: clientName,
        clientId: client.client_id,
        scopes: scope,
      });

      res.status(201).json({
        client: clientPayload(storedClient),
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

  router.delete('/clients/:clientId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspace = await findWorkspaceOr404(req, res, repo);
      if (!workspace) return;
      const clientId = req.params.clientId;
      const revoked = clientId ? await repo.revokeClient(workspace.id, clientId) : false;
      if (!revoked) {
        res.status(404).json({ error: 'mcp_client_not_found' });
        return;
      }
      res.json({ ok: true });
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
      await db.transaction(async (tx) => {
        await tx
          .update(schema.workspaces)
          .set({ gbrainMcpProxyEnabled: enabled })
          .where(eq(schema.workspaces.id, workspaceId));
        if (!enabled) {
          const now = new Date();
          await tx
            .update(schema.workspaceMcpClients)
            .set({ revokedAt: now })
            .where(
              and(
                eq(schema.workspaceMcpClients.workspaceId, workspaceId),
                isNull(schema.workspaceMcpClients.revokedAt),
              ),
            );
          await tx
            .update(schema.workspaceMcpAccessTokens)
            .set({ revokedAt: now })
            .where(
              and(
                eq(schema.workspaceMcpAccessTokens.workspaceId, workspaceId),
                isNull(schema.workspaceMcpAccessTokens.revokedAt),
              ),
            );
        }
      });
    },
    async listClients(workspaceId) {
      return db
        .select({
          id: schema.workspaceMcpClients.id,
          label: schema.workspaceMcpClients.label,
          scopes: schema.workspaceMcpClients.scopes,
          createdAt: schema.workspaceMcpClients.createdAt,
          lastUsedAt: schema.workspaceMcpClients.lastUsedAt,
          revokedAt: schema.workspaceMcpClients.revokedAt,
        })
        .from(schema.workspaceMcpClients)
        .where(eq(schema.workspaceMcpClients.workspaceId, workspaceId))
        .orderBy(desc(schema.workspaceMcpClients.createdAt));
    },
    async createClient(input) {
      const [client] = await db
        .insert(schema.workspaceMcpClients)
        .values({
          workspaceId: input.workspaceId,
          createdByUserId: input.createdByUserId,
          label: input.label,
          clientIdHash: hashMcpCredential(input.clientId),
          scopes: input.scopes,
        })
        .returning({
          id: schema.workspaceMcpClients.id,
          label: schema.workspaceMcpClients.label,
          scopes: schema.workspaceMcpClients.scopes,
          createdAt: schema.workspaceMcpClients.createdAt,
          lastUsedAt: schema.workspaceMcpClients.lastUsedAt,
          revokedAt: schema.workspaceMcpClients.revokedAt,
        });
      if (!client) throw new Error('mcp_client_insert_failed');
      return client;
    },
    async revokeClient(workspaceId, clientId) {
      const now = new Date();
      return db.transaction(async (tx) => {
        const [client] = await tx
          .update(schema.workspaceMcpClients)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.workspaceMcpClients.workspaceId, workspaceId),
              eq(schema.workspaceMcpClients.id, clientId),
              isNull(schema.workspaceMcpClients.revokedAt),
            ),
          )
          .returning({ id: schema.workspaceMcpClients.id });
        if (!client) return false;
        await tx
          .update(schema.workspaceMcpAccessTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.workspaceMcpAccessTokens.workspaceId, workspaceId),
              eq(schema.workspaceMcpAccessTokens.clientId, client.id),
              isNull(schema.workspaceMcpAccessTokens.revokedAt),
            ),
          );
        return true;
      });
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

function clientPayload(client: WorkspaceMcpClientRow) {
  return {
    id: client.id,
    label: client.label,
    scopes: client.scopes,
    createdAt: client.createdAt,
    lastUsedAt: client.lastUsedAt,
    revokedAt: client.revokedAt,
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
