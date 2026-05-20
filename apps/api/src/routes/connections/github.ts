import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';

import { getWorkspaceReadiness } from '../../auth/membership.js';
import { generateNonce, signState, verifyState } from '../../connections/state-hmac.js';
import { db, schema } from '../../db/client.js';
import { OPEN42_EDITION, OPEN42_INGEST_HMAC_SECRET } from '../../env.js';
import type { GbrainClient } from '../../gbrain/client.js';
import { buildGbrainForWorkspace } from '../../gbrain/factory.js';
import {
  buildGitHubAppManifestUrl,
  convertGitHubAppManifestCode,
  resolveGitHubAppClientForWorkspace,
  storeWorkspaceGitHubAppConfig,
} from '../../github/app-config.js';
import {
  createGbrainSourceId,
  createGitProxyToken,
  directGithubCloneUrl,
  hashGitProxyToken,
  normalizeGithubPathFilters,
  proxiedGithubCloneUrl,
  type GitHubSyncTransport,
} from '../../github/bridge.js';
import {
  GitHubApiError,
  GitHubAppClient,
  GitHubAuthRequiredError,
  sanitizeGithubError,
  type GitHubInstallationRepository,
} from '../../github/client.js';

export interface GitHubRouterDeps {
  github?: GitHubAppClient;
  gbrain?: (workspaceId: string) => Promise<GbrainSourceClient>;
  kick?: (workspaceId: string) => Promise<void>;
  fetch?: typeof fetch;
}

type GbrainSourceClient = Pick<GbrainClient, 'sourcesAdd' | 'submitJob' | 'sourcesStatus'>;

interface RepoSelection {
  repoId: string;
  owner: string;
  repo: string;
  branch: string | null;
  pathFilters: string[];
}

interface VerifiedRepoSelection {
  repoId: string;
  owner: string;
  repo: string;
  branch: string;
  private: boolean;
  pathFilters: string[];
}

const MAX_REPOS_PER_FINALIZE = 20;

export function buildGitHubRouter(deps: GitHubRouterDeps = {}) {
  const router = Router({ mergeParams: true });
  const gbrainForWorkspace = deps.gbrain ?? buildGbrainForWorkspace;
  const kick = deps.kick ?? (async () => undefined);

  router.post('/github/app-manifest/init', async (req, res, next) => {
    try {
      if (OPEN42_EDITION === 'cloud') {
        res.status(404).json({ error: 'github_app_manifest_unavailable' });
        return;
      }
      if (!isWorkspaceAdmin(req.workspace?.role)) {
        res.status(403).json({ error: 'forbidden_admin_only' });
        return;
      }
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'github_not_configured', detail: 'hmac_secret_missing' });
        return;
      }
      const workspaceId = req.workspace!.id;
      const readiness = await getWorkspaceReadiness(workspaceId);
      if (!readiness || readiness.status !== 'ready' || !readiness.gbrainReady) {
        res.status(425).json({
          error: 'workspace_not_ready',
          status: readiness?.status ?? 'unknown',
        });
        return;
      }
      const nonce = generateNonce();
      const expiresAt = Date.now() + 60 * 60 * 1000;
      const state = signState(OPEN42_INGEST_HMAC_SECRET, {
        workspaceId,
        userId: req.session!.userId,
        nonce,
        expiresAt,
        serviceId: 'github-app-manifest',
      });
      await db.insert(schema.connectionInitStates).values({
        state,
        workspaceId,
        userId: req.session!.userId,
        kind: 'github-repo',
        serviceId: 'github-app-manifest',
        expiresAt: new Date(expiresAt),
      });
      res.json({
        redirect_url: buildGitHubAppManifestUrl({
          workspaceId,
          state,
          nameSeed: nonce.slice(0, 8),
        }),
        state,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/github/app-manifest/finalize', async (req, res, next) => {
    try {
      if (OPEN42_EDITION === 'cloud') {
        res.status(404).json({ error: 'github_app_manifest_unavailable' });
        return;
      }
      if (!isWorkspaceAdmin(req.workspace?.role)) {
        res.status(403).json({ error: 'forbidden_admin_only' });
        return;
      }
      const verified = await verifyGitHubState(req, res, 'github-app-manifest');
      if (!verified) return;
      const code = normalizeManifestCode(req.body?.code);
      if (!code) {
        res.status(400).json({ error: 'missing_code' });
        return;
      }
      const initState = await loadInitState(verified.state, 'github-app-manifest');
      if (!initState) {
        res.status(410).json({ error: 'state_expired' });
        return;
      }

      const app = await convertGitHubAppManifestCode(code, deps.fetch ?? fetch);
      const workspaceId = req.workspace!.id;
      await storeWorkspaceGitHubAppConfig({
        workspaceId,
        userId: req.session!.userId,
        app,
      });
      await db
        .delete(schema.connectionInitStates)
        .where(eq(schema.connectionInitStates.state, verified.state));

      const github = await resolveGitHubAppClientForWorkspace(workspaceId, deps.github);
      if (!github?.isConfigured()) {
        res.status(503).json({ error: 'github_not_configured' });
        return;
      }
      const installState = await createGitHubInstallState({
        workspaceId,
        userId: req.session!.userId,
      });
      res.json({
        ok: true,
        app: {
          id: String(app.id),
          slug: app.slug,
          name: app.name,
        },
        redirect_url: github.installUrl(installState),
      });
    } catch (err) {
      if (err instanceof GitHubApiError) {
        res.status(err.status ?? 502).json({ error: sanitizeGithubError(err) });
        return;
      }
      next(err);
    }
  });

  router.post('/github/init', async (req, res, next) => {
    try {
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'github_not_configured', detail: 'hmac_secret_missing' });
        return;
      }
      const workspaceId = req.workspace!.id;
      const readiness = await getWorkspaceReadiness(workspaceId);
      if (!readiness || readiness.status !== 'ready' || !readiness.gbrainReady) {
        res.status(425).json({
          error: 'workspace_not_ready',
          status: readiness?.status ?? 'unknown',
        });
        return;
      }
      const github = await resolveGitHubAppClientForWorkspace(workspaceId, deps.github);
      if (!github?.isConfigured()) {
        res.status(503).json({
          error: 'github_not_configured',
          setup: OPEN42_EDITION === 'community' ? 'github_app_manifest' : 'cloud_admin_required',
        });
        return;
      }

      const state = await createGitHubInstallState({
        workspaceId,
        userId: req.session!.userId,
      });
      res.json({ redirect_url: github.installUrl(state), state });
    } catch (err) {
      next(err);
    }
  });

  router.post('/github/finalize', async (req, res, next) => {
    try {
      const verified = await verifyGitHubState(req, res);
      if (!verified) return;
      const installationId = normalizeInstallationId(req.body?.installationId);
      if (!installationId) {
        res.status(400).json({ error: 'missing_installation_id' });
        return;
      }

      const initState = await loadInitState(verified.state, 'github');
      if (!initState) {
        res.status(410).json({ error: 'state_expired' });
        return;
      }
      if (initState.composioPendingId && initState.composioPendingId !== installationId) {
        res.status(400).json({ error: 'installation_id_mismatch' });
        return;
      }

      const github = await resolveGitHubAppClientForWorkspace(req.workspace!.id, deps.github);
      if (!github?.isConfigured()) {
        res.status(503).json({ error: 'github_not_configured' });
        return;
      }
      const installation = await github.getInstallation(installationId);
      if (installation.repositorySelection === 'all') {
        res.status(422).json({
          error: 'github_selected_repositories_required',
          configureUrl: installation.htmlUrl,
        });
        return;
      }
      const repos = await github.listInstallationRepositories(installationId);
      await db
        .update(schema.connectionInitStates)
        .set({ composioPendingId: installationId })
        .where(eq(schema.connectionInitStates.state, verified.state));

      res.json({
        installationId,
        repositories: repos.map((repo) => ({
          id: String(repo.id),
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner.login,
          private: repo.private,
          defaultBranch: repo.default_branch,
        })),
        sync: {
          engine: 'gbrain',
          privateRepoTransport: 'open42-git-proxy',
          branchSelection: 'default_branch_only',
          pathFilters: 'not_supported_by_gbrain_sync',
        },
      });
    } catch (err) {
      if (err instanceof GitHubAuthRequiredError) {
        res.status(401).json({ error: 'github_auth_required' });
        return;
      }
      if (err instanceof GitHubApiError) {
        res.status(err.status ?? 502).json({ error: sanitizeGithubError(err) });
        return;
      }
      next(err);
    }
  });

  router.post('/github/repos', async (req, res, next) => {
    try {
      const verified = await verifyGitHubState(req, res);
      if (!verified) return;
      const installationId = normalizeInstallationId(req.body?.installationId);
      const requestedRepos = normalizeRepoSelections(req.body?.repositories);
      if (!installationId || requestedRepos.length === 0) {
        res.status(400).json({ error: 'invalid_github_selection' });
        return;
      }

      const initState = await loadInitState(verified.state, 'github');
      if (!initState || initState.composioPendingId !== installationId) {
        res.status(410).json({ error: 'state_expired' });
        return;
      }

      const github = await resolveGitHubAppClientForWorkspace(req.workspace!.id, deps.github);
      if (!github?.isConfigured()) {
        res.status(503).json({ error: 'github_not_configured' });
        return;
      }
      const installation = await github.getInstallation(installationId);
      if (installation.repositorySelection === 'all') {
        res.status(422).json({
          error: 'github_selected_repositories_required',
          configureUrl: installation.htmlUrl,
        });
        return;
      }
      const installationRepos = await github.listInstallationRepositories(installationId);
      const verifiedRepos = verifyRepoSelections(requestedRepos, installationRepos);
      if ('error' in verifiedRepos) {
        res.status(422).json({ error: verifiedRepos.error });
        return;
      }

      const workspaceId = req.workspace!.id;
      const gbrain = await gbrainForWorkspace(workspaceId);
      const created: Array<{
        connectionId: string;
        repo: string;
        gbrainSourceId: string;
        registered: boolean;
        error?: string;
      }> = [];

      for (const repo of verifiedRepos.repos) {
        const createdConnection = await createGitHubConnectionRow({
          workspaceId,
          installationId,
          repo,
        });
        let registered = false;
        let registrationError: string | undefined;
        try {
          await registerGbrainSource({
            workspaceId,
            connectionId: createdConnection.connectionId,
            gbrain,
            repo,
            gbrainSourceId: createdConnection.gbrainSourceId,
            rawProxyToken: createdConnection.rawProxyToken,
          });
          registered = true;
        } catch (err) {
          registrationError = sanitizeGithubError(err);
          await markGitHubRegistrationError(createdConnection.connectionId, err);
        }
        created.push({
          connectionId: createdConnection.connectionId,
          repo: `${repo.owner}/${repo.repo}`,
          gbrainSourceId: createdConnection.gbrainSourceId,
          registered,
          ...(registrationError ? { error: registrationError } : {}),
        });
      }

      await db
        .delete(schema.connectionInitStates)
        .where(eq(schema.connectionInitStates.state, verified.state));

      if (created.some((item) => item.registered)) {
        void kick(workspaceId).catch(() => undefined);
      }
      res.status(201).json({ ok: true, connections: created });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'github_repo_connection_exists' });
        return;
      }
      if (err instanceof GitHubAuthRequiredError) {
        res.status(401).json({ error: 'github_auth_required' });
        return;
      }
      if (err instanceof GitHubApiError) {
        res.status(err.status ?? 502).json({ error: sanitizeGithubError(err) });
        return;
      }
      next(err);
    }
  });

  router.patch('/github/:connectionId', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const connection = await loadWorkspaceGitHubConnection(workspaceId, req.params.connectionId);
      if (!connection) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const pathFilters =
        req.body?.pathFilters === undefined ? [] : normalizeGithubPathFilters(req.body.pathFilters);
      if (pathFilters.length > 0) {
        res.status(422).json({ error: 'github_path_filters_not_supported' });
        return;
      }
      const branch = normalizeBranch(req.body?.branch);
      if (branch && branch !== connection.branch) {
        res.status(422).json({ error: 'github_branch_changes_not_supported' });
        return;
      }
      await db
        .update(schema.githubRepoConnections)
        .set({ syncStatus: 'behind', lastError: null, updatedAt: new Date() })
        .where(eq(schema.githubRepoConnections.connectionId, connection.connectionId));
      await db
        .update(schema.connections)
        .set({ status: 'pending_import', lastError: null })
        .where(eq(schema.connections.id, connection.connectionId));

      void kick(workspaceId).catch(() => undefined);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/github/:connectionId/sync', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const connection = await loadWorkspaceGitHubConnection(workspaceId, req.params.connectionId);
      if (!connection) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await db
        .update(schema.connections)
        .set({ status: 'pending_import', lastError: null })
        .where(eq(schema.connections.id, connection.connectionId));
      await db
        .update(schema.githubRepoConnections)
        .set({ syncStatus: 'syncing', lastError: null, updatedAt: new Date() })
        .where(eq(schema.githubRepoConnections.connectionId, connection.connectionId));
      void kick(workspaceId).catch(() => undefined);
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/github/:connectionId/retry-reconciliation', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const connection = await loadWorkspaceGitHubConnection(workspaceId, req.params.connectionId);
      if (!connection) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (!connection.gbrainSourceRegisteredAt) {
        const rawProxyToken =
          connection.syncTransport === 'open42-git-proxy' ? createGitProxyToken() : null;
        if (rawProxyToken) {
          await db
            .update(schema.githubRepoConnections)
            .set({
              gitProxyTokenHash: hashGitProxyToken(rawProxyToken),
              updatedAt: new Date(),
            })
            .where(eq(schema.githubRepoConnections.connectionId, connection.connectionId));
        }
        const gbrain = await gbrainForWorkspace(workspaceId);
        await registerGbrainSource({
          workspaceId,
          connectionId: connection.connectionId,
          gbrain,
          repo: {
            repoId: connection.repoId,
            owner: connection.owner,
            repo: connection.repo,
            branch: connection.branch,
            private: connection.repoPrivate,
            pathFilters: [],
          },
          gbrainSourceId: connection.gbrainSourceId,
          rawProxyToken,
        });
      }
      await db
        .update(schema.githubRepoConnections)
        .set({ syncStatus: 'syncing', lastError: null, updatedAt: new Date() })
        .where(eq(schema.githubRepoConnections.connectionId, connection.connectionId));
      void kick(workspaceId).catch(() => undefined);
      res.status(202).json({ ok: true });
    } catch (err) {
      await markGitHubRegistrationError(req.params.connectionId, err).catch(() => undefined);
      next(err);
    }
  });

  router.post('/github/:connectionId/reconnect', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const connection = await loadWorkspaceGitHubConnection(workspaceId, req.params.connectionId);
      if (!connection) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (!OPEN42_INGEST_HMAC_SECRET) {
        res.status(503).json({ error: 'github_not_configured', detail: 'hmac_secret_missing' });
        return;
      }
      const github = await resolveGitHubAppClientForWorkspace(workspaceId, deps.github);
      if (!github?.isConfigured()) {
        res.status(503).json({ error: 'github_not_configured' });
        return;
      }
      const state = await createGitHubInstallState({
        workspaceId,
        userId: req.session!.userId,
        installationId: connection.installationId,
      });
      res.json({ redirect_url: github.installUrl(state), state });
    } catch (err) {
      next(err);
    }
  });

  router.post('/github/:connectionId/repair-webhook', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const connection = await loadWorkspaceGitHubConnection(workspaceId, req.params.connectionId);
      if (!connection) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      await db
        .update(schema.githubRepoConnections)
        .set({ webhookHealth: 'healthy', syncStatus: 'behind', updatedAt: new Date() })
        .where(eq(schema.githubRepoConnections.connectionId, connection.connectionId));
      void kick(workspaceId).catch(() => undefined);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export async function markGitHubReposBehind(input: {
  repoId: string;
  branch: string;
  headSha?: string | null;
  kick: (workspaceId: string) => Promise<void>;
}): Promise<number> {
  const rows = await db
    .select({
      id: schema.githubRepoConnections.id,
      workspaceId: schema.githubRepoConnections.workspaceId,
    })
    .from(schema.githubRepoConnections)
    .where(
      and(
        eq(schema.githubRepoConnections.repoId, input.repoId),
        eq(schema.githubRepoConnections.branch, input.branch),
      ),
    );
  if (rows.length === 0) return 0;
  const ids = rows.map((row) => row.id);
  await db
    .update(schema.githubRepoConnections)
    .set({
      ...(input.headSha ? { branchHeadSha: input.headSha } : {}),
      syncStatus: 'behind',
      webhookHealth: 'healthy',
      lastError: null,
      updatedAt: new Date(),
    })
    .where(inArray(schema.githubRepoConnections.id, ids));
  await Promise.all(rows.map((row) => input.kick(row.workspaceId).catch(() => undefined)));
  return rows.length;
}

export async function markGitHubInstallationAuthRequired(installationId: string): Promise<void> {
  await db
    .update(schema.githubRepoConnections)
    .set({
      syncStatus: 'auth_required',
      lastError: sanitizeGithubError(new GitHubAuthRequiredError()),
      updatedAt: new Date(),
    })
    .where(eq(schema.githubRepoConnections.installationId, installationId));
}

async function createGitHubInstallState(input: {
  workspaceId: string;
  userId: string;
  installationId?: string | null;
}): Promise<string> {
  const expiresAt = Date.now() + 20 * 60 * 1000;
  const state = signState(OPEN42_INGEST_HMAC_SECRET, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    nonce: generateNonce(),
    expiresAt,
    serviceId: 'github',
  });
  await db.insert(schema.connectionInitStates).values({
    state,
    workspaceId: input.workspaceId,
    userId: input.userId,
    kind: 'github-repo',
    serviceId: 'github',
    composioPendingId: input.installationId ?? null,
    expiresAt: new Date(expiresAt),
  });
  return state;
}

async function createGitHubConnectionRow(input: {
  workspaceId: string;
  installationId: string;
  repo: VerifiedRepoSelection;
}): Promise<{
  connectionId: string;
  gbrainSourceId: string;
  rawProxyToken: string | null;
}> {
  const gbrainSourceId = createGbrainSourceId();
  const rawProxyToken = input.repo.private ? createGitProxyToken() : null;
  const syncTransport: GitHubSyncTransport = input.repo.private
    ? 'open42-git-proxy'
    : 'direct-url';
  const [connection] = await db
    .insert(schema.connections)
    .values({
      workspaceId: input.workspaceId,
      kind: 'github-repo',
      serviceId: 'github',
      status: 'pending_import',
      displayName: `GitHub · ${input.repo.owner}/${input.repo.repo}`,
      cursor: {},
    })
    .returning();
  if (!connection) throw new Error('github_connection_insert_failed');
  await db.insert(schema.githubRepoConnections).values({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    installationId: input.installationId,
    repoId: input.repo.repoId,
    owner: input.repo.owner,
    repo: input.repo.repo,
    branch: input.repo.branch,
    repoPrivate: input.repo.private,
    gbrainSourceId,
    syncTransport,
    gitProxyTokenHash: rawProxyToken ? hashGitProxyToken(rawProxyToken) : null,
    pathFilters: [],
    syncStatus: 'syncing',
    webhookHealth: 'unknown',
  });
  return { connectionId: connection.id, gbrainSourceId, rawProxyToken };
}

async function registerGbrainSource(input: {
  workspaceId: string;
  connectionId: string;
  gbrain: GbrainSourceClient;
  repo: VerifiedRepoSelection;
  gbrainSourceId: string;
  rawProxyToken: string | null;
}): Promise<void> {
  const cloneUrl = input.repo.private
    ? proxiedGithubCloneUrl({
        owner: input.repo.owner,
        repo: input.repo.repo,
        token: requiredProxyToken(input.rawProxyToken),
      })
    : directGithubCloneUrl(input.repo.owner, input.repo.repo);
  await input.gbrain.sourcesAdd({
    id: input.gbrainSourceId,
    name: `${input.repo.owner}/${input.repo.repo}`,
    url: cloneUrl,
    federated: false,
  });
  await db
    .update(schema.githubRepoConnections)
    .set({
      gbrainSourceRegisteredAt: new Date(),
      syncStatus: 'syncing',
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.githubRepoConnections.connectionId, input.connectionId));
}

async function markGitHubRegistrationError(connectionId: string, err: unknown): Promise<void> {
  const status = err instanceof GitHubAuthRequiredError ? 'auth_required' : 'errored';
  await db
    .update(schema.githubRepoConnections)
    .set({
      syncStatus: status,
      lastError: sanitizeGithubError(err),
      updatedAt: new Date(),
    })
    .where(eq(schema.githubRepoConnections.connectionId, connectionId));
  await db
    .update(schema.connections)
    .set({ status: 'errored', lastError: sanitizeGithubError(err) })
    .where(eq(schema.connections.id, connectionId));
}

function verifyRepoSelections(
  requested: RepoSelection[],
  installationRepos: GitHubInstallationRepository[],
): { repos: VerifiedRepoSelection[] } | { error: string } {
  const reposById = new Map(installationRepos.map((repo) => [String(repo.id), repo]));
  const repos: VerifiedRepoSelection[] = [];
  for (const selection of requested) {
    const repo = reposById.get(selection.repoId);
    if (
      !repo ||
      repo.owner.login !== selection.owner ||
      repo.name !== selection.repo
    ) {
      return { error: 'github_repo_not_installed' };
    }
    const branch = selection.branch ?? repo.default_branch;
    if (branch !== repo.default_branch) {
      return { error: 'github_branch_not_supported' };
    }
    if (selection.pathFilters.length > 0) {
      return { error: 'github_path_filters_not_supported' };
    }
    repos.push({
      repoId: String(repo.id),
      owner: repo.owner.login,
      repo: repo.name,
      branch,
      private: repo.private,
      pathFilters: [],
    });
  }
  return { repos };
}

async function verifyGitHubState(
  req: { body?: Record<string, unknown>; workspace?: { id: string }; session?: { userId: string } },
  res: { status: (code: number) => { json: (value: unknown) => void } },
  expectedServiceId = 'github',
): Promise<{ state: string } | null> {
  if (!OPEN42_INGEST_HMAC_SECRET) {
    res.status(503).json({ error: 'github_not_configured' });
    return null;
  }
  const state = typeof req.body?.state === 'string' ? req.body.state : '';
  const payload = verifyState(OPEN42_INGEST_HMAC_SECRET, state);
  if (!payload || payload.serviceId !== expectedServiceId) {
    res.status(400).json({ error: 'state_invalid' });
    return null;
  }
  if (payload.workspaceId !== req.workspace?.id) {
    res.status(400).json({ error: 'state_metadata_mismatch' });
    return null;
  }
  if (payload.userId !== req.session?.userId) {
    res.status(403).json({ error: 'state_user_mismatch' });
    return null;
  }
  return { state };
}

async function loadInitState(state: string, expectedServiceId: string) {
  const [row] = await db
    .select()
    .from(schema.connectionInitStates)
    .where(eq(schema.connectionInitStates.state, state))
    .limit(1);
  if (
    !row ||
    row.kind !== 'github-repo' ||
    row.serviceId !== expectedServiceId ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }
  return row;
}

async function loadWorkspaceGitHubConnection(workspaceId: string, connectionId: string) {
  const [row] = await db
    .select()
    .from(schema.githubRepoConnections)
    .where(
      and(
        eq(schema.githubRepoConnections.workspaceId, workspaceId),
        eq(schema.githubRepoConnections.connectionId, connectionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function normalizeRepoSelections(value: unknown): RepoSelection[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_REPOS_PER_FINALIZE).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const repoId = normalizeId(raw.repoId);
    const owner = normalizeOwnerRepo(raw.owner);
    const repo = normalizeOwnerRepo(raw.repo);
    const branch = normalizeBranch(raw.branch);
    if (!repoId || !owner || !repo) return [];
    return [
      {
        repoId,
        owner,
        repo,
        branch,
        pathFilters: normalizeGithubPathFilters(raw.pathFilters),
      },
    ];
  });
}

function normalizeInstallationId(value: unknown): string | null {
  return normalizeId(value);
}

function normalizeManifestCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,200}$/.test(trimmed) ? trimmed : null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function normalizeOwnerRepo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.-]{1,100}$/.test(trimmed) ? trimmed : null;
}

function normalizeBranch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || trimmed.includes('..') || trimmed.startsWith('/')) {
    return null;
  }
  return trimmed;
}

function requiredProxyToken(value: string | null): string {
  if (!value) throw new Error('github_proxy_token_missing');
  return value;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}

function isWorkspaceAdmin(role: unknown): boolean {
  return role === 'owner' || role === 'admin';
}
